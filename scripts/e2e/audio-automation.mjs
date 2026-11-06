export async function renderedAutomation() {
  const { trackParam } = await import('/src/audio/curve.ts');
  const { holdAt } = await import('/src/audio/param.ts');
  const sr = 48000;
  const out = [];
  const schedules = {
    sameTime: (p) => {
      p.setValueAtTime(0.8, 0.5);
      p.setTargetAtTime(0, 0.5, 0.25);
      holdAt(p, 1.25);
      return { at: 1.25, held: Math.fround(0.8) * Math.exp(-3) };
    },
    setRamp: (p) => {
      p.setValueAtTime(0.8, 0.5);
      p.linearRampToValueAtTime(0.4, 0.5);
    },
    cancelledTarget: (p) => {
      p.setTargetAtTime(0, 0.5, 0.25);
      p.cancelScheduledValues(0.5);
      p.setTargetAtTime(0.5, 0.5, 0.25);
      holdAt(p, 1.25);
    },
    heldRampTarget: (p) => {
      p.setValueAtTime(1, 0);
      p.linearRampToValueAtTime(0.9, 0.125);
      holdAt(p, 0.125);
      p.setTargetAtTime(0, 0.125, 0.1);
      holdAt(p, 0.75);
    },
    heldStepRamp: (p) => {
      p.linearRampToValueAtTime(0.9, 0.5);
      p.setTargetAtTime(0.75, 0.5, 0);
      holdAt(p, 0.5);
      p.linearRampToValueAtTime(0, 0.5);
    },
    heldStepTarget: (p) => {
      p.linearRampToValueAtTime(0.9, 0.5);
      p.setTargetAtTime(0.75, 0.5, 0);
      holdAt(p, 0.5);
      p.setTargetAtTime(0, 0.5, 0.1);
      holdAt(p, 1);
    },
    instantRamp: (p) => p.linearRampToValueAtTime(0.4, 0),
    heldRampRamp: (p) => {
      p.linearRampToValueAtTime(0.6, 0.5);
      holdAt(p, 0.5);
      p.linearRampToValueAtTime(0.2, 0.5);
      holdAt(p, 1.25);
      return { at: 1.25, held: Math.fround(0.2) };
    },
    pastHold: (p, advance) => {
      p.setValueAtTime(1, 0);
      p.linearRampToValueAtTime(0, 2);
      const at = advance(1);
      holdAt(p, 0.5);
      return { at, held: 1 - at / 2 };
    },
    pastCancel: (p, advance) => {
      p.setValueAtTime(0.8, 0);
      p.setValueAtTime(0.6, 0.75);
      p.setTargetAtTime(0, 1.5, 0.25);
      const at = advance(1);
      p.cancelScheduledValues(0.5);
      return { at, held: Math.fround(0.6) };
    },
    compactedRamp: (p, advance) => {
      p.setValueAtTime(1, 0);
      p.setTargetAtTime(0, 0.25, 0.5);
      p.linearRampToValueAtTime(0.25, 2);
      advance(1);
      p.setValueAtTime(0.75, 2.5);
      holdAt(p, 1.5);
    },
    implicit: (p) => p.linearRampToValueAtTime(0, 2),
    sets: (p) => {
      p.setValueAtTime(0.25, 0.25);
      p.setValueAtTime(0.5, 1);
      p.setValueAtTime(0.625, 1.5);
    },
    ordered: (p) => {
      p.setValueAtTime(1, 0);
      p.linearRampToValueAtTime(0, 2);
      holdAt(p, 1);
      p.setValueAtTime(0.5, 1);
    },
    targets: (p) => {
      p.setTargetAtTime(0, 0.25, 0.5);
      p.setTargetAtTime(1, 0.75, 0.25);
      p.setValueAtTime(0.25, 1.5);
    },
    zeroTarget: (p) => {
      p.setTargetAtTime(0, 0.25, 0);
      p.setTargetAtTime(0.75, 0.5, 0);
    },
    zeroTargetRamp: (p) => {
      p.setTargetAtTime(0, 0.25, 0);
      p.linearRampToValueAtTime(0.25, 1.5);
    },
    startedTargetRamp: (p, advance) => {
      p.setTargetAtTime(0, 0.25, 0.5);
      advance(0.75);
      p.linearRampToValueAtTime(0.25, 1.5);
      holdAt(p, 1.25);
    },
    targetRamp: (p) => {
      p.setTargetAtTime(0, 0.25, 0.5);
      p.linearRampToValueAtTime(0.25, 1.5);
    },
    cancelled: (p) => {
      p.setValueAtTime(0.5, 0);
      p.linearRampToValueAtTime(0, 1);
      p.setTargetAtTime(1, 1.5, 0.25);
      p.cancelScheduledValues(0.75);
    },
    held: (p) => {
      p.setValueAtTime(1, 0.25);
      p.linearRampToValueAtTime(0, 2.25);
      holdAt(p, 1.25);
      holdAt(p, 1.75);
    },
  };
  for (const [name, schedule] of Object.entries(schedules)) {
    const c = new OfflineAudioContext(1, 3 * sr, sr);
    const clock = { currentTime: 0 };
    const gain = c.createGain();
    gain.connect(c.destination);
    const source = c.createConstantSource();
    source.connect(gain);
    source.start();
    const p = trackParam(gain.gain, clock, name === 'sets' ? 0.75 : 1);
    const expected = [];
    let nextSample = 0;
    const sampleUntil = (end) => {
      for (; nextSample < end; nextSample += 97) expected.push([nextSample, p.valueAt(nextSample / sr)]);
    };
    const advance = (at) => {
      sampleUntil(Math.round(at * sr));
      clock.currentTime = at;
      return at;
    };
    const checks = schedule(p, advance);
    sampleUntil(3 * sr);
    expected.push([3 * sr - 1, p.valueAt((3 * sr - 1) / sr)]);
    const data = (await c.startRendering()).getChannelData(0);
    const error = Math.max(...expected.map(([i, value]) => Math.abs(data[i] - value)));
    let maxStep = 0;
    const outsideSample = expected.filter(([i, value]) => {
      const step = Math.max(Math.abs(data[i] - data[Math.max(0, i - 1)]),
        Math.abs(data[Math.min(data.length - 1, i + 1)] - data[i]));
      maxStep = Math.max(maxStep, step);
      return !Number.isFinite(step) || Math.abs(data[i] - value) > step + 2e-7;
    });
    const held = checks?.held;
    const actual = held === undefined ? undefined : data[Math.round(checks.at * sr)];
    const samples = outsideSample.slice(0, 3).map(([i, expected]) => ({ i, expected, actual: data[i] }));
    out.push({ name, error, maxStep, outsideSample: samples, held, actual });
  }
  return out;
}

export async function rejectedAutomation() {
  const { trackParam } = await import('/src/audio/curve.ts');
  const { holdAt } = await import('/src/audio/param.ts');
  const methods = ['setValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime'];
  const schedules = [];
  for (const method of methods) for (const tau of [0, 0.1]) schedules.push({
    name: `out-of-order-${method}-${tau}`, message: 'time order',
    before: (p) => { p.setValueAtTime(1, 0); p.linearRampToValueAtTime(0, 1); },
    reject: (p) => p[method](0.5, 0.5, tau),
  });
  for (const tau of [0, 0.1]) schedules.push({
    name: `target-ramp-target-${tau}`, message: 'same-time',
    before: (p) => { p.setValueAtTime(1, 0); p.setTargetAtTime(0.6, 0.5, tau); },
    reject: (p) => p.linearRampToValueAtTime(0.2, 0.5),
  });
  schedules.push({
    name: 'earlier-co-timed-sequence', message: 'same-time',
    before: (p) => {
      p.setValueAtTime(1, 0);
      p.linearRampToValueAtTime(0.9, 0.125);
      holdAt(p, 0.125);
      p.setValueAtTime(0.74, 0.125);
      p.setTargetAtTime(0.4, 0.125, 0.1);
    },
    reject: (p) => p.setTargetAtTime(0.74, 0.125, 0.01),
  });
  for (const first of methods) for (const next of methods) {
    if (first !== 'setTargetAtTime' && (next !== 'setValueAtTime' || first === 'linearRampToValueAtTime')) continue;
    schedules.push({
      name: `${first}-${next}`, message: 'same-time',
      before: (p) => p[first](0.6, 0.5, 0.1),
      reject: (p) => p[next](0.4, 0.5, 0.1),
    });
  }
  for (const first of methods.slice(0, 2)) for (const next of methods.slice(1)) schedules.push({
    name: `${first}-${next}-target`, message: 'same-time',
    before: (p) => { p[first](0.6, 0.5); p[next](0.4, 0.5, 0.1); },
    reject: (p) => p.setTargetAtTime(0, 0.5, 0.1),
  });
  const results = [];
  for (const schedule of schedules) {
    const c = new OfflineAudioContext(1, 48000, 48000);
    const gain = c.createGain();
    gain.connect(c.destination);
    const source = c.createConstantSource();
    source.connect(gain);
    source.start();
    const p = trackParam(gain.gain, c, 1);
    schedule.before(p);
    const samples = [0.25, 0.75, 0.99];
    const before = samples.map((at) => p.valueAt(at));
    let message = '';
    try {
      schedule.reject(p);
    } catch (error) {
      message = error.message;
    }
    const unchanged = samples.every((at, i) => p.valueAt(at) === before[i]);
    const data = (await c.startRendering()).getChannelData(0);
    const error = Math.max(...samples.map((at, i) => Math.abs(data[Math.round(at * 48000)] - before[i])));
    results.push({ name: schedule.name, rejected: message.includes(schedule.message), unchanged, error });
  }
  return results;
}

export async function repeatedTargets() {
  const { trackParam } = await import('/src/audio/curve.ts');
  const { holdAt } = await import('/src/audio/param.ts');
  const sr = 48000;
  const seconds = 61;
  const c = new OfflineAudioContext(2, seconds * sr, sr);
  const clock = { currentTime: 0 };
  const merger = c.createChannelMerger(2);
  merger.connect(c.destination);
  const source = c.createConstantSource();
  source.start();
  const curves = [0, 1].map((channel) => {
    const gain = c.createGain();
    source.connect(gain);
    gain.connect(merger, 0, channel);
    const p = trackParam(gain.gain, clock, 1);
    p.setTargetAtTime(0, 0, 0.25);
    return p;
  });
  const expected = curves.map(() => new Float64Array(seconds * sr));
  const holdFrames = [30, 907, 1815, 3583];
  const holdSamples = [];
  let nextSample = 0;
  let evaluationWork = 0;
  let compactionError = 0;
  const sampleUntil = (end) => {
    for (; nextSample < Math.round(end * sr); nextSample++) {
      curves.forEach((p, channel) => { expected[channel][nextSample] = p.valueAt(nextSample / sr); });
    }
  };
  for (let frame = 1; frame <= 3600; frame++) {
    const at = frame / 60;
    sampleUntil(at);
    clock.currentTime = at;
    for (const p of curves) {
      const before = p.valueAt(at);
      p.setTargetAtTime(frame % 2 ? 0.3 : 0.7, at + 0.01, 0.25);
      compactionError = Math.max(compactionError, Math.abs(p.valueAt(at) - before));
      const exp = Math.exp;
      let calls = 0;
      Math.exp = (value) => { calls++; return exp(value); };
      try {
        p.valueAt(at);
      } finally {
        Math.exp = exp;
      }
      evaluationWork = Math.max(evaluationWork, calls);
    }
    if (holdFrames.includes(frame)) {
      const heldAt = at + 0.007;
      holdAt(curves[1], heldAt);
      holdSamples.push(Math.round(heldAt * sr));
    }
  }
  sampleUntil(seconds);
  const buffer = await c.startRendering();
  return curves.map((_, channel) => {
    const data = buffer.getChannelData(channel);
    let maxRelativeError = 0;
    for (let i = 0; i < data.length; i++) {
      const error = Math.abs(data[i] - expected[channel][i]);
      maxRelativeError = Math.max(maxRelativeError, error / Math.abs(data[i]));
    }
    const holds = channel === 0 ? [] : holdSamples.map((i) => ({
      at: i / sr, relativeStep: Math.abs(data[i] - data[i - 1]) / Math.abs(data[i - 1]),
    }));
    return { channel, seconds, targets: 3601, maxRelativeError, holds, evaluationWork, compactionError };
  });
}
