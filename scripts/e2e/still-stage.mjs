export async function watchStage(page, refresh = false) {
  await page.evaluate((refresh) => {
    const s = window.__stage;
    const counts = window.__backdropCounts = { scenes: 0, blooms: 0 };
    const render = s.renderer.render.bind(s.renderer);
    s.renderer.render = (scene, camera) => {
      if (scene === s.scene) counts.scenes++;
      return render(scene, camera);
    };
    const blur = s.bloom.mipmapBlurPass;
    const bloom = blur.render.bind(blur);
    blur.render = (...args) => {
      counts.blooms++;
      return bloom(...args);
    };
    if (refresh) s.invalidate();
  }, refresh);
}

export const stageState = (page) => page.evaluate(() => ({
  ...window.__backdropCounts,
  time: window.__stage.time,
  width: window.__stage.canvas.width,
  height: window.__stage.canvas.height,
  lost: window.__stage.lost,
  frames: window.__e2eTrail.frames,
  loopFrames: window.__stage.frameLog.length,
  lastFrameAgo: window.__e2eTrail.lastFrame === null ? null : performance.now() - window.__e2eTrail.lastFrame,
}));

async function sampleStage(page, options) {
  return page.evaluate(async ({ times, live = false, redraw = false, stale = false }) => {
    const s = window.__stage;
    const gl = s.renderer.getContext();
    const pass = s.composer.passes.at(-1);
    const scale = pass.timeScale;
    const time = pass.fullscreenMaterial.time;
    const background = s.scene.background.clone();
    const children = s.scene.children.map((child) => [child, child.visible]);
    let sampleTime = times[0];
    const off = s.onUpdate(() => { pass.fullscreenMaterial.time = sampleTime; });
    const sample = async () => {
      pass.fullscreenMaterial.time = sampleTime;
      if (live) await new Promise((done) => requestAnimationFrame(done));
      else s.draw(0);
      const pixels = new Uint8Array(s.canvas.width * s.canvas.height * 4);
      gl.readPixels(0, 0, s.canvas.width, s.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    pass.timeScale = 0;
    try {
      if (stale) {
        s.scene.background.setRGB(1, 0.2, 0.1);
        for (const [child] of children) child.visible = false;
      }
      let previous = await sample();
      let maxDelta = 0;
      let changed = 0;
      let samples = 0;
      for (sampleTime of times.slice(1)) {
        if (redraw) s.invalidate();
        const next = await sample();
        for (let i = 0; i < next.length; i++) {
          maxDelta = Math.max(maxDelta, Math.abs(previous[i] - next[i]));
          if (i % 4 === 3) continue;
          changed += Number(previous[i] !== next[i]);
          samples++;
        }
        previous = next;
      }
      return { maxDelta, grain: changed / samples };
    } finally {
      off();
      if (stale) {
        s.scene.background.copy(background);
        for (const [child, visible] of children) child.visible = visible;
        s.invalidate();
        s.draw(0);
      }
      pass.timeScale = scale;
      pass.fullscreenMaterial.time = time;
    }
  }, options);
}

export async function compareStillFrame(page, stale = false) {
  return (await sampleStage(page, { times: [0.5, 0.5], redraw: true, stale })).maxDelta;
}

export async function grain(page) {
  const times = Array.from({ length: 4 }, (_, i) => 0.5 + i / 60);
  return (await sampleStage(page, { times, live: true })).grain;
}
