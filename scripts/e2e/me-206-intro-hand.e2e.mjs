// The hero's hand in the intro. His pose layer stacked on itself whenever it ran twice in one frame (three.js skips
// rewriting a bone whose clip value didn't change), so the reach put his hand in front of his face, the lift put it
// over his head, and the fingers stayed a claw. His aura's glow and smoke also drew over his hands, arms and face.
// The first scenario steps the real intro frame by frame and checks the hand where the shots frame it; the second
// checks every pose gives the same bones however often it runs and that a positive curl closes either hand.

import fs from 'node:fs';
import path from 'node:path';

/** Each case runs the same frame three more times: a pose that moves on a re-run has stacked. */
const SAME = 1e-4;

async function probe(page) {
  await page.evaluate(() => {
    const hero = () => {
      let g;
      window.__stage.scene.traverse((o) => { if (o.name === 'hero') g = o; });
      return g;
    };
    const at = (n) => { const b = hero().getObjectByName(n); return b.getWorldPosition(b.position.clone()); };
    const bones = () => { const a = []; hero().traverse((o) => o.isBone && a.push(o.getWorldPosition(o.position.clone()))); return a; };
    const pause = () => new Promise((r) => setTimeout(r));
    window.__hand = {
      visible: () => !!hero()?.visible,
      async step(until, max = 4000) {
        for (let i = 0; i < max && !until(); i++) { window.__stage.step(1 / 15); await pause(); }
        return until();
      },
      read() {
        const before = bones();
        for (let i = 0; i < 3; i++) window.__stage.step(0);
        const after = bones();
        return {
          lt: window.__awakenLT ?? null,
          drift: Math.max(...before.map((p, i) => p.distanceTo(after[i]))),
          hand: at('hand_r').y,
          shoulder: at('upperarm_r').y,
          neck: at('neck_01').y,
          // index tip to wrist: grows as the palm opens
          open: at('index_04_leaf_r').distanceTo(at('hand_r')),
        };
      },
      // how much his aura changes the picture on his face, hands and forearms (0-255 per channel, at each point on screen)
      veil() {
        const s = window.__stage;
        const L = (a, b, t) => at(a).lerp(at(b), t);
        const face = hero().getObjectByName('face');
        const pts = {
          face: face.getWorldPosition(face.position.clone()),
          'left hand': L('hand_l', 'middle_01_l', 0.5),
          'right hand': L('hand_r', 'middle_01_r', 0.5),
          'left forearm': L('lowerarm_l', 'hand_l', 0.45),
          'right forearm': L('lowerarm_r', 'hand_r', 0.45),
        };
        const xy = Object.values(pts).map((v) => { const p = v.clone().project(s.camera); return [((p.x + 1) / 2) * s.canvas.width, ((1 - p.y) / 2) * s.canvas.height]; });
        const c = document.createElement('canvas');
        const sample = () => {
          c.width = s.canvas.width;
          c.height = s.canvas.height;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(s.canvas, 0, 0);
          return xy.map(([x, y]) => {
            if (x < 2 || y < 2 || x > c.width - 2 || y > c.height - 2) return null;
            const d = g.getImageData(Math.round(x) - 1, Math.round(y) - 1, 3, 3).data;
            let t = 0;
            for (let i = 0; i < 36; i += 4) t += d[i] + d[i + 1] + d[i + 2];
            return t / 27;
          });
        };
        const aura = s.scene.children.find((o) => o.name === 'aura');
        const on = sample();
        aura.visible = false;
        s.step(0);
        const off = sample();
        aura.visible = true;
        s.step(0);
        return Object.fromEntries(Object.keys(pts).map((k, i) => [k, on[i] === null ? null : Math.abs(on[i] - off[i])]));
      },
      // how far his hand sits from the gate's beam of light on screen, in screen widths
      gap() {
        const cam = window.__stage.camera;
        const hand = at('middle_01_r');
        const beam = window.__stage.scene.children.find((o) => o.name === 'gate').getWorldPosition(hand.clone()).setY(hand.y);
        return Math.abs(hand.clone().project(cam).x - beam.project(cam).x) / 2;
      },
    };
  });
}

const near = (x) => +x.toFixed(4);
const fmt = (m) => JSON.stringify(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' ? near(v) : v])));

export const scenarios = {
  'intro hand: the reach, lift and grip land where the shots frame them': async (h) => {
    const { page, errors } = await h.open({}, '?shot=silhouette&capture&mute&dpr=1&nopost');
    await page.waitForFunction(() => !!window.__stage, null, { timeout: 60000 });
    await probe(page);
    const { HIT, slam } = await page.evaluate(async () => ({
      HIT: (await import('/src/cutscene/awaken-shots.ts')).HIT,
      slam: (await import('/src/scene/awaken/rubble.ts')).RUBBLE.slam,
    }));
    const slamAt = HIT + slam;
    const log = [];
    const read = async (label) => {
      const m = await page.evaluate(() => window.__hand.read());
      const veil = await page.evaluate(() => window.__hand.veil());
      log.push(`${label} ${fmt(m)} aura ${fmt(veil)}`);
      h.expect(m.drift < SAME, `${label}: re-running the same frame moved his bones by ${near(m.drift)} m`);
      for (const [part, d] of Object.entries(veil)) if (d !== null) h.expect(d < 6, `${label}: his aura draws over his ${part} (${near(d)} of 255)`);
      return m;
    };
    const stepTo = (lt) => page.evaluate((lt) => window.__hand.step(() => (window.__awakenLT ?? -1) >= lt), lt);
    // the stage draws only when stepped: save the canvas itself rather than a page screenshot
    const snap = async (name) => {
      const png = await page.evaluate(() => window.__stage.canvas.toDataURL('image/png'));
      fs.writeFileSync(path.join(h.out, name + '.png'), Buffer.from(png.split(',')[1], 'base64'));
    };
    const frames = (n) => page.evaluate((n) => { let i = 0; return window.__hand.step(() => ++i > n); }, n);

    // silhouette: he breathes with his hands at his sides; the right fist is the closed reference
    h.expect(await page.evaluate(() => window.__hand.step(() => window.__hand.visible())), 'the hero never appeared');
    await frames(30);
    const fist = await read('silhouette');
    await frames(75);
    await read('silhouette later');

    // the reach: palm up at his waist, open, his face above it, through the wide insert and the front mid shot
    let reach;
    for (const lt of [2.7, 3.42, 4.2, 6.6]) {
      h.expect(await stepTo(lt), `the AWAKEN beat never reached ${lt} s`);
      const m = await read(`reach ${lt}`);
      h.expect(m.hand < m.shoulder - 0.12, `reach ${lt}: his hand is at ${near(m.hand)} m, up by his shoulder (${near(m.shoulder)} m) instead of at his waist`);
      h.expect(m.open > fist.open + 0.015, `reach ${lt}: his palm never opened (index tip ${near(m.open)} m from the wrist, a fist is ${near(fist.open)} m)`);
      reach ??= m;
      if (lt === 3.42) await snap('intro-hand-reach');
    }

    // the shot from 11.9 to 13.1 s lines his raised hand up with the gate's light; in it the stones come down and the
    // hand closes, then eases open again
    h.expect(await stepTo(slamAt - 0.2), 'the AWAKEN beat never reached the slam');
    const { closed, gap } = await page.evaluate(async ([slamEnd, shot]) => {
      let closed = Infinity, gap = 0;
      await window.__hand.step(() => {
        const lt = window.__awakenLT;
        if (lt <= slamEnd) closed = Math.min(closed, window.__hand.read().open);
        if (lt >= shot[0] && lt <= shot[1]) gap = Math.max(gap, window.__hand.gap());
        return lt >= shot[1];
      });
      return { closed, gap };
    }, [slamAt + 0.7, [11.95, 13.05]]);
    log.push(`grip ${near(closed)}, hand to beam ${near(gap)} W`);
    h.expect(closed < reach.open - 0.015, `his hand never closed on the slam (index tip ${near(closed)} m from the wrist)`);
    h.expect(gap < 0.015, `his raised hand sits ${near(gap)} screen widths off the gate's light instead of in front of it`);
    await snap('intro-hand-gate');

    // the risen stand: the hand held at shoulder height, never over his head
    for (const lt of [13.4, 14.3]) {
      h.expect(await stepTo(lt), `the AWAKEN beat never reached ${lt} s`);
      const m = await read(`raised ${lt}`);
      h.expect(m.hand > m.shoulder - 0.15 && m.hand < m.neck, `raised ${lt}: his hand is at ${near(m.hand)} m; shoulder height is ${near(m.shoulder)} m, his neck ${near(m.neck)} m`);
      h.expect(Math.abs(m.open - reach.open) < 0.005, `raised ${lt}: his hand didn't open again after the grip (${near(m.open)} m)`);
      if (lt === 14.3) await snap('intro-hand-raised');
    }

    // the chest beat: the chest rises in front of him while he stands at rest
    const chestUp = await page.evaluate(() => window.__hand.step(() => !!window.__stage.scene.children.find((o) => o.name === 'chest')?.visible));
    h.expect(chestUp, 'the chest beat never started');
    await frames(15);
    h.expect(await page.evaluate(() => window.__hand.visible()), 'the hero is gone in the chest beat');
    await read('chest');
    h.expect(!errors.length, errors.join('\n'));
    return log;
  },

  'intro hand: every pose gives the same bones however often it runs, and a positive curl closes either hand': async (h) => {
    const { page, errors } = await h.open({}, '?lab=character&view=front&pose=idle&light=eval&mute&dpr=1');
    await page.waitForFunction(() => !!window.__lab, null, { timeout: 60000 });
    const r = await page.evaluate(async () => {
      const { POSES } = await import('/src/scene/character/hero.ts');
      const { jw } = window.__lab;
      const at = (n) => { const b = jw.group.getObjectByName(n); return b.getWorldPosition(b.position.clone()); };
      const bones = () => { const a = []; jw.group.traverse((o) => o.isBone && a.push(o.getWorldPosition(o.position.clone()))); return a; };
      const cases = Object.entries(POSES).map(([name, p]) => [name, [p, null, 0]]);
      cases.push(['awaken halfway to awakenHigh', [POSES.awaken, POSES.awakenHigh, 0.5]]);
      cases.push(['idle with a breath added', [POSES.idle, POSES.idle, 0, { chest: [0.012, 0, 0], head: [0.008, 0.01, 0] }]]);
      cases.push(['awaken over the reach and hold clips', [{ ...POSES.awaken, '@reach': [0.6, 0, 0], '@hold': [0.3, 0, 0] }, null, 0]]);
      const drift = {};
      for (const [name, args] of cases) {
        jw.rig.apply(...args);
        const once = bones();
        jw.rig.apply(...args);
        jw.rig.apply(...args);
        const again = bones();
        drift[name] = Math.max(...once.map((p, i) => p.distanceTo(again[i])));
      }
      const curl = {};
      for (const s of ['l', 'r']) {
        const S = s.toUpperCase();
        const m = (pose) => {
          jw.rig.apply(pose, null, 0);
          return { fingers: at(`index_04_leaf_${s}`).distanceTo(at(`hand_${s}`)), thumb: at(`thumb_04_leaf_${s}`).distanceTo(at(`pinky_01_${s}`)) };
        };
        curl[S] = { closed: m({ ['fi' + S]: [0, 0, 0.6], ['th' + S]: [0, 0, 0.6] }), clip: m({}), opened: m({ ['fi' + S]: [0, 0, -0.6], ['th' + S]: [0, 0, -0.6] }) };
      }
      return { drift, curl };
    });
    for (const [name, d] of Object.entries(r.drift)) h.expect(d < SAME, `${name}: running the pose again moved his bones by ${near(d)} m`);
    for (const [side, c] of Object.entries(r.curl)) {
      h.expect(c.closed.fingers < c.clip.fingers && c.clip.fingers < c.opened.fingers, `${side} hand: a positive finger curl doesn't close it ${JSON.stringify(c)}`);
      h.expect(c.closed.thumb < c.clip.thumb && c.clip.thumb < c.opened.thumb, `${side} hand: a positive thumb curl doesn't move it toward the palm ${JSON.stringify(c)}`);
    }
    h.expect(!errors.length, errors.join('\n'));
    return r;
  },
};
