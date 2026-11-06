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
  width: document.getElementById('gl').width,
  height: document.getElementById('gl').height,
  lost: window.__stage.lost,
  frames: window.__e2eTrail.frames,
  loopFrames: window.__stage.frameLog.length,
  lastFrameAgo: window.__e2eTrail.lastFrame === null ? null : performance.now() - window.__e2eTrail.lastFrame,
}));

export async function compareStillFrame(page, stale = false) {
  return page.evaluate((stale) => {
    const s = window.__stage;
    const gl = s.renderer.getContext();
    const pass = s.composer.passes.at(-1);
    const scale = pass.timeScale;
    const time = pass.fullscreenMaterial.time;
    const background = s.scene.background.clone();
    const children = s.scene.children.map((child) => [child, child.visible]);
    const sample = () => {
      s.draw(0);
      const pixels = new Uint8Array(s.canvas.width * s.canvas.height * 4);
      gl.readPixels(0, 0, s.canvas.width, s.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    pass.timeScale = 0;
    pass.fullscreenMaterial.time = 0.5;
    try {
      if (stale) {
        s.scene.background.setRGB(1, 0.2, 0.1);
        for (const [child] of children) child.visible = false;
      }
      const kept = sample();
      s.invalidate();
      const redrawn = sample();
      let maxDelta = 0;
      for (let i = 0; i < kept.length; i++) maxDelta = Math.max(maxDelta, Math.abs(kept[i] - redrawn[i]));
      return maxDelta;
    } finally {
      if (stale) {
        s.scene.background.copy(background);
        for (const [child, visible] of children) child.visible = visible;
        s.invalidate();
        s.draw(0);
      }
      pass.timeScale = scale;
      pass.fullscreenMaterial.time = time;
    }
  }, stale);
}
