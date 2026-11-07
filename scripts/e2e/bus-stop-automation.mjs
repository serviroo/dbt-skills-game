export async function renderedBusDips(buses = [
  'duckG', 'uiDuck', 'focus', 'yieldG', 'hushBeds', 'hushMusic', 'hushHall', 'hushRoom', 'safe',
]) {
  const { AudioEngine } = await import('/src/audio/engine.ts');
  const { stoppedBy } = await import('/src/audio/voice.ts');
  const sr = 48000;
  const horizon = stoppedBy(0.25, 0.04);
  const hold = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'cancelAndHoldAtTime');
  const results = [];
  for (const firefox of [false, true]) {
    if (firefox) delete AudioParam.prototype.cancelAndHoldAtTime;
    try {
      for (const bus of buses) {
        const c = new OfflineAudioContext(1, sr, sr);
        const eng = new AudioEngine(c, { volume: 0 });
        eng.bed('gate_hum', { at: 0, level: 0 });
        const node = eng[bus];
        node.disconnect();
        node.connect(c.destination);
        const source = c.createConstantSource();
        source.connect(node);
        source.start();
        for (const [db, ramp, at] of [[-18, 0.05, 0], [0, 0.08, 0.28], [-22, 0.05, 0.30]]) {
          if (bus === 'duckG') eng.duck(db, ramp, at);
          else eng.busLevels.set(node.curve, 10 ** (db / 20), at, ramp / 4);
        }
        eng.stopAll(0.04, 0.25);
        const data = (await c.startRendering()).getChannelData(0);
        let rise = 0;
        for (let i = 0.25 * sr + 1; i < Math.floor(horizon * sr); i++) {
          rise = Math.max(rise, data[i] - data[i - 1]);
        }
        results.push({ bus, firefox, horizon, held: data[0.25 * sr], rise });
      }
    } finally {
      if (hold) Object.defineProperty(AudioParam.prototype, 'cancelAndHoldAtTime', hold);
    }
  }
  return results;
}

export async function renderedHorizonCollisions() {
  const { AudioEngine } = await import('/src/audio/engine.ts');
  const { stoppedBy } = await import('/src/audio/voice.ts');
  const sr = 48000;
  const horizon = stoppedBy(0.25, 0.04);
  const hold = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'cancelAndHoldAtTime');
  const results = [];
  for (const firefox of [false, true]) {
    if (firefox) delete AudioParam.prototype.cancelAndHoldAtTime;
    try {
      for (const kind of ['set', 'linear', 'set-target', 'linear-target', 'early-linear-target']) {
        const c = new OfflineAudioContext(1, sr, sr);
        const eng = new AudioEngine(c, { volume: 0 });
        eng.bed('gate_hum', { at: 0, level: 0 });
        const node = eng.duckG;
        node.disconnect();
        node.connect(c.destination);
        const source = c.createConstantSource();
        source.connect(node);
        source.start();
        eng.duck(-18, 0.05, 0);
        eng.duck(0, 0.08, 0.28);
        const p = node.curve;
        const changeAt = kind.startsWith('early') ? 0.3 : horizon;
        if (kind.startsWith('set')) p.setValueAtTime(0.2, horizon);
        else p.linearRampToValueAtTime(kind.startsWith('early') ? 0.05 : 0.2, changeAt);
        if (kind.endsWith('target')) p.setTargetAtTime(0.7, changeAt, 0.02);
        let error = '';
        try {
          eng.stopAll(0.04, 0.25);
        } catch (e) {
          error = e.message;
        }
        const data = (await c.startRendering()).getChannelData(0);
        let rise = 0;
        for (let i = 0.25 * sr + 1; i < Math.floor(horizon * sr); i++) {
          rise = Math.max(rise, data[i] - data[i - 1]);
        }
        results.push({ firefox, kind, error, rise, end: data.at(-1),
          dipKept: !kind.startsWith('early') || Math.abs(data[0.3 * sr] - 0.05) < 1e-6,
          expected: kind.endsWith('target') ? 0.7 : 0.2 });
      }
    } finally {
      if (hold) Object.defineProperty(AudioParam.prototype, 'cancelAndHoldAtTime', hold);
    }
  }
  return results;
}
