export async function runPauseCases([cues, tap, LEAD]) {
  const { Voice } = await import('/src/audio/voice.ts');
  const { AudioEngine } = await import('/src/audio/engine.ts');
  const open = Voice.prototype.open;
  const play = AudioEngine.prototype.play;
  const set = AudioParam.prototype.setValueAtTime;
  const ramp = AudioParam.prototype.linearRampToValueAtTime;
  const start = OscillatorNode.prototype.start;
  const connect = AudioNode.prototype.connect;
  const clock = window.__taps[tap].context;
  const lead = Math.max(LEAD, (clock.baseLatency || 0) + 1 / 60);
  let seam = '';
  let duration = 0;
  let paused = false;
  let timing;
  let handle;
  let connections = 0;
  const pause = () => {
    paused = true;
    const before = clock.currentTime;
    const wall = performance.now();
    const until = performance.now() + duration;
    while (performance.now() < until);
    timing = { before, after: clock.currentTime, wall: performance.now() - wall };
  };
  Voice.prototype.open = function (...args) {
    if (window.__watch && seam === 'open' && !paused) {
      pause();
      timing.requested = args[0];
    }
    return open.apply(this, args);
  };
  AudioEngine.prototype.play = function (...args) {
    handle = play.apply(this, args);
    return handle;
  };
  AudioParam.prototype.setValueAtTime = function (...args) {
    const result = set.apply(this, args);
    if (window.__watch && seam === 'placement' && !paused) {
      pause();
      timing.requested = args[1];
    }
    return result;
  };
  AudioParam.prototype.linearRampToValueAtTime = function (...args) {
    const result = ramp.apply(this, args);
    if (window.__watch && seam === 'ramp' && !paused) pause();
    return result;
  };
  OscillatorNode.prototype.start = function (...args) {
    const result = start.apply(this, args);
    if (window.__watch && seam === 'source' && !paused) pause();
    return result;
  };
  AudioNode.prototype.connect = function (...args) {
    const result = connect.apply(this, args);
    if (window.__watch && this instanceof ChannelSplitterNode && !paused) {
      connections++;
      if ((seam === 'placement' && connections === 2) || (seam === 'ramp' && connections === 3)) pause();
    }
    return result;
  };
  try {
    const results = [];
    for (const cue of cues)
      for (duration of [65, 500])
        for (seam of ['open', 'placement', 'source', 'ramp']) {
          paused = false;
          connections = 0;
          handle = undefined;
          const before = window.__behind.length;
          const ask = clock.currentTime;
          window.__watch = true;
          window.__daily.sound(cue);
          const endBeforeAck = handle?.end;
          const ack =
            handle?.started &&
            (await Promise.race([
              handle.started,
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('The cue did not acknowledge its start')), 15000),
              ),
            ]));
          window.__watch = false;
          const end = handle?.end;
          results.push({
            cue,
            duration,
            seam,
            paused,
            timing,
            ask,
            end,
            endBeforeAck,
            start: ack?.start,
            receivedAt: ack?.receivedAt,
            lead,
            behind: window.__behind.slice(before),
          });
          if (ack) {
            const limit = performance.now() + 15000;
            while (clock.currentTime < end + 0.2) {
              if (performance.now() > limit) throw new Error('The cue did not finish');
              await new Promise((done) => setTimeout(done, 10));
            }
          }
        }
    return results;
  } finally {
    window.__watch = false;
    Voice.prototype.open = open;
    AudioEngine.prototype.play = play;
    AudioParam.prototype.setValueAtTime = set;
    AudioParam.prototype.linearRampToValueAtTime = ramp;
    OscillatorNode.prototype.start = start;
    AudioNode.prototype.connect = connect;
  }
}

export function timelineScenarios({
  boot,
  note,
  TIMELINE_CUES,
  Q,
  LEAD,
  ONSET,
  PARTS,
  audioReady,
  audioHeard,
  audioRecorded,
  measureCueEnergy,
}) {
  return {
    async 'cue-reaches-audio-before-the-page-stalls'(h) {
      const { ctx, page, errors } = await boot(h, { music: 0, sfx: 1 });
      try {
        const results = await page.evaluate(async (cues) => {
          const { AudioEngine } = await import('/src/audio/engine.ts');
          const play = AudioEngine.prototype.play;
          let engine;
          AudioEngine.prototype.play = function (...args) {
            engine = this;
            return play.apply(this, args);
          };
          try {
            window.__daily.sound('check');
          } finally {
            AudioEngine.prototype.play = play;
          }
          await engine.timeline.ready;
          const clock = engine.ctx;
          const results = [];
          for (const cue of cues)
            for (const duration of [65, 500]) {
              const ask = clock.currentTime;
              const handle = engine.play(cue);
              const until = performance.now() + duration;
              while (performance.now() < until);
              const after = clock.currentTime;
              const ack = await handle.started;
              results.push({ cue, duration, ask, after, ...ack });
            }
          return results;
        }, TIMELINE_CUES);
        const missed = results.filter((r) => r.after - r.receivedAt < 0.02 || r.start < r.ask);
        h.expect(!missed.length, `Cues reached the audio thread after the stall: ${JSON.stringify(missed)}`);
        h.expect(!errors.length, errors.join('\n'));
        return results;
      } finally {
        await ctx.close();
      }
    },
    async 'cue-placement-survives-main-thread-pauses'(h) {
      const { ctx, page, errors, tap } = await boot(h, { music: 0, sfx: 1 });
      try {
        const results = await page.evaluate(
          runPauseCases,
          [TIMELINE_CUES, tap, LEAD],
        );
        for (const r of results) note(h, 'paused-placement', { ...r, behind: r.behind.length });
        const missed = results.filter(
          (r) =>
            !r.paused ||
            r.behind.length ||
            r.start === undefined ||
            r.start < r.ask - 1e-4 ||
            r.start < r.receivedAt - 1e-4 ||
            r.start > r.receivedAt + r.lead + 1e-4,
        );
        const missedDetails = missed.map((r) =>
          `${r.cue} ${r.duration} ms ${r.seam}: paused=${r.paused}, behind=${r.behind.length}, start=${r.start}`,
        ).join('; ');
        h.expect(!missed.length,
          `${missed.length} cues missed a pause, missed their acknowledgement ` +
            'or placed calls behind the audio clock: ' +
            missedDetails);
        await audioRecorded(page, tap, Math.max(...results.map((r) => r.end)) + 0.2);
        const measured = await page.evaluate(measureCueEnergy, [
          results,
          tap,
          TIMELINE_CUES,
          Q,
          ONSET,
          PARTS,
        ]);
        const sum = (bs, i) => bs.reduce((total, block) => total + block[i], 0);
        const bad = [];
        results.forEach((result, i) => {
          const { blocks, onset, parts } = measured[i];
          const ratio = (bs) => sum(bs, 0) / (sum(bs, 1) + sum(bs, 2));
          const first = ratio(onset.slice(0, 2));
          const attack = ratio(onset);
          const levels = parts.map(ratio);
          note(h, 'paused-energy', {
            cue: result.cue,
            duration: result.duration,
            seam: result.seam,
            first,
            attack,
            levels,
          });
          if (
            onset.length < 3 ||
            blocks.some((b) => !Number.isFinite(b[0])) ||
            !(first >= 0.5) ||
            !(attack >= 0.6 && attack <= 1.7) ||
            levels.some((v) => !(v >= 0.7 && v <= 1.4))
          ) {
            bad.push(
              `${result.cue} ${result.duration} ms ${result.seam}: first=${first}, attack=${attack}, parts=${levels}`,
            );
          }
        });
        h.expect(!bad.length, `${bad.length} cues did not match their offline renders: ${bad.join('; ')}`);
        const stale = results.filter((r) => r.duration === 500 && r.seam === 'open').map((r) => ({
          ...r, start: undefined, end: r.endBeforeAck,
        }));
        const staleMeasured = await page.evaluate(measureCueEnergy, [stale, tap, TIMELINE_CUES, Q, ONSET, PARTS]);
        const staleMisses = staleMeasured.filter(({ onset }) => {
          const expected = sum(onset, 1) + sum(onset, 2);
          return expected > 0 && sum(onset, 0) / expected < 0.6;
        }).length;
        h.expect(staleMisses === stale.length && stale.length === TIMELINE_CUES.length,
          `The provisional start did not expose the shifted attack: ${staleMisses}/${stale.length}`);
        h.expect(!errors.length, errors.join('\n'));
        return { cases: results.length, staleMisses };
      } finally {
        await ctx.close();
      }
    },
    async 'cue-stops-survive-main-thread-pauses'(h) {
      const { ctx, page, errors } = await boot(h, { music: 0, sfx: 1 });
      try {
        const probe = await page.evaluate(async () => {
          const { AudioEngine } = await import('/src/audio/engine.ts');
          const play = AudioEngine.prototype.play;
          let engine;
          AudioEngine.prototype.play = function (...args) {
            engine = this;
            return play.apply(this, args);
          };
          try {
            window.__daily.sound('ui_tap');
          } finally {
            AudioEngine.prototype.play = play;
          }
          window.__stopEngine = engine;
          const output = engine.ctx.createGain();
          engine.testInput('sfx').connect(output);
          output.connect(engine.ctx.destination);
          return window.__taps.findIndex((t) => t.node === output);
        });
        await audioReady(page);
        const results = await page.evaluate(async () => {
          const { Voice, stoppedBy } = await import('/src/audio/voice.ts');
          const engine = window.__stopEngine;
          const clock = engine.ctx;
          const original = Voice.prototype.stop;
          let target;
          let paused;
          Voice.prototype.stop = function (...args) {
            if (this === target && !paused) {
              const until = performance.now() + 500;
              while (performance.now() < until);
              paused = clock.currentTime;
            }
            return original.apply(this, args);
          };
          const until = async (condition, what) => {
            const limit = performance.now() + 15000;
            while (!condition()) {
              if (performance.now() > limit) throw new Error(`${what} did not finish`);
              await new Promise((done) => setTimeout(done, 10));
            }
          };
          try {
            const results = [];
            for (const mode of ['handle', 'stopAll', 'quiet', 'schedule']) {
              const at = clock.currentTime + 0.06;
              let handle;
              if (mode === 'schedule') {
                engine.schedule([{ t: 0, cue: 'chest_rise', opts: { id: 'stop-probe' } }], at);
                handle = engine.named.get('stop-probe');
              } else handle = engine.play('chest_rise', { at });
              const start = (await handle.started).start;
              const voice = [...engine.active].at(-1);
              await until(() => clock.currentTime >= start + 0.15, 'The cue opening');
              target = voice;
              paused = 0;
              const ask = clock.currentTime;
              const requested = ask + 0.05;
              const before = window.__behind.length;
              window.__watch = mode === 'handle';
              if (mode === 'handle') handle.stop(requested, 0.05);
              else if (mode === 'stopAll') engine.stopAll(0.05, requested);
              else if (mode === 'quiet') engine.quiet(true, 0.05, requested);
              else
                engine.schedule([{ t: 0, cue: 'stop', opts: { id: 'stop-probe', ramp: 0.05 } }], requested);
              await until(() => !voice.pendingStops.length, 'The cue stop');
              window.__watch = false;
              const stop = voice.stopStartsAt;
              const silent = voice.silentAt;
              results.push({
                mode,
                start,
                ask,
                requested,
                paused,
                stop,
                silent,
                expected: stoppedBy(stop, 0.05),
                behind: window.__behind.slice(before),
              });
              await until(() => clock.currentTime >= silent + 0.25, 'The cue silence');
              if (mode === 'quiet') engine.quiet(false, 0.05);
            }
            return results;
          } finally {
            window.__watch = false;
            Voice.prototype.stop = original;
          }
        });
        await audioRecorded(page, probe, Math.max(...results.map((r) => r.silent)) + 0.25);
        const failures = [];
        for (const r of results) {
          const before = await audioHeard(page, probe, r.start + 0.2, r.stop, [0, 0]);
          const after = await audioHeard(page, probe, r.silent + 0.04, r.silent + 0.2, [0, 0]);
          note(h, 'paused-stop', { ...r, behind: r.behind.length, before: before.rms, after: after.rms });
          if (
            !r.paused ||
            r.stop < r.paused - 1e-4 ||
            Math.abs(r.silent - r.expected) > 1e-6 ||
            r.behind.length ||
            !(before.rms > 1e-6) ||
            !(after.rms < 3e-5)
          ) {
            failures.push(
              `${r.mode}: paused=${r.paused}, stop=${r.stop}, silent=${r.silent}, ` +
                `behind=${r.behind.length}, RMS=${before.rms}/${after.rms}`,
            );
          }
        }
        h.expect(!failures.length, failures.join('; '));
        h.expect(!errors.length, errors.join('\n'));
        return { cases: results.length };
      } finally {
        await ctx.close();
      }
    },
    async 'cue-stop-reaches-audio-before-the-page-stalls'(h) {
      const { ctx, page, errors } = await boot(h, { music: 0, sfx: 1 });
      try {
        const probe = await page.evaluate(async () => {
          const { AudioEngine } = await import('/src/audio/engine.ts');
          const play = AudioEngine.prototype.play;
          let engine;
          AudioEngine.prototype.play = function (...args) {
            engine = this;
            return play.apply(this, args);
          };
          try {
            window.__daily.sound('ui_tap');
          } finally {
            AudioEngine.prototype.play = play;
          }
          window.__stopEngine = engine;
          const output = engine.ctx.createGain();
          engine.testInput('sfx').connect(output);
          output.connect(engine.ctx.destination);
          return window.__taps.findIndex((tap) => tap.node === output);
        });
        await audioReady(page);
        const result = await page.evaluate(async () => {
          const { stoppedBy } = await import('/src/audio/voice.ts');
          const engine = window.__stopEngine;
          const clock = engine.ctx;
          const wait = async (check) => {
            while (!check()) await new Promise((resolve) => setTimeout(resolve, 10));
          };
          const handle = engine.play('chest_rise', { at: clock.currentTime + 0.06 });
          const start = (await handle.started).start;
          const voice = [...engine.active].at(-1);
          await wait(() => clock.currentTime >= start + 0.25);
          const requested = clock.currentTime + 0.05;
          handle.stop(requested, 0.05);
          const until = performance.now() + 500;
          while (performance.now() < until);
          await wait(() => !voice.pendingStops.length);
          return { start, requested, stopped: voice.stopStartsAt, silent: stoppedBy(requested, 0.05) };
        });
        await audioRecorded(page, probe, result.silent + 0.2);
        const before = await audioHeard(page, probe, result.start + 0.1, result.requested, [0, 0]);
        const after = await audioHeard(page, probe, result.silent + 0.03, result.silent + 0.18, [0, 0]);
        note(h, 'stop-before-stall', { ...result, before: before.rms, after: after.rms });
        h.expect(
          Math.abs(result.stopped - result.requested) < 1e-4,
          `The stop reached audio ${((result.stopped - result.requested) * 1000).toFixed(1)} ms late`,
        );
        h.expect(
          before.rms > 1e-6 && after.rms < 3e-5,
          `The cue was not cut during the stall: RMS ${before.rms} before and ${after.rms} after`,
        );
        h.expect(!errors.length, errors.join('\n'));
        return result;
      } finally {
        await ctx.close();
      }
    },
    async 'live-cues-match-their-native-waveforms'(h) {
      const results = [];
      for (const cue of [
        ...TIMELINE_CUES,
        '__phase_sine',
        '__phase_triangle',
        '__phase_sawtooth',
        '__phase_square',
        '__phase_envelope',
        '__phase_fm',
        '__phase_mod',
      ])
        for (const offset of ['check', '__phase_sine', '__phase_fm'].includes(cue)
          ? [0.25, 37.25, 90.25]
          : [37.25]) {
          const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
          try {
            await page.waitForFunction(() => window.__lab === true);
            const result = await page.evaluate(
              async ({ cue, offset }) => {
                const { AudioEngine } = await import('/src/audio/engine.ts');
                const { CUES: definitions } = await import('/src/audio/cues.ts');
                definitions.__phase_sine = {
                  timeline: true,
                  fn: (voice) => voice.osc('sine', 880, voice.t, voice.t + 1, voice.wet),
                };
                for (const shape of ['triangle', 'sawtooth', 'square'])
                  definitions[`__phase_${shape}`] = {
                    timeline: true,
                    fn: (voice) => voice.osc(shape, 880, voice.t, voice.t + 1, voice.wet),
                  };
                definitions.__phase_envelope = {
                  timeline: true,
                  fn: (voice) => {
                    const gain = voice.gain(0, voice.wet);
                    const end = voice.perc(gain.gain, voice.t, 0.045, 0.005, 0.24);
                    voice.osc('sine', 880, voice.t, end, gain);
                  },
                };
                definitions.__phase_fm = {
                  timeline: true,
                  fn: (voice) =>
                    voice.fm({
                      t: voice.t,
                      f: 880,
                      ratio: 1,
                      index: 0.9,
                      idxEnd: 0.1,
                      idxTau: 0.08,
                      a: 0.005,
                      tau: 0.24,
                      peak: 0.045,
                      dest: voice.wet,
                    }),
                };
                definitions.__phase_mod = {
                  timeline: true,
                  fn: (voice) => {
                    const gain = voice.gain(0, voice.wet);
                    const param = voice.at(gain.gain);
                    param.setValueAtTime(792, voice.t);
                    param.setTargetAtTime(88, voice.t + 0.005, 0.08);
                    voice.osc('sine', 880, voice.t, voice.t + 1, gain);
                  },
                };
                const capture = async (cue, timeline, offset, rate) => {
                  if (!timeline) {
                    const frame = 12800;
                    const length = Math.ceil(1.4 * rate);
                    const clock = new OfflineAudioContext(2, frame - 128 + length, rate);
                    const engine = new AudioEngine(clock);
                    engine.volume.disconnect();
                    engine.testInput('sfx').connect(clock.destination);
                    engine.play(cue, { at: (frame + offset) / rate });
                    const data = await clock.startRendering();
                    return {
                      left: data.getChannelData(0).slice(frame - 128),
                      right: data.getChannelData(1).slice(frame - 128),
                      rate,
                      frame,
                    };
                  }
                  const clock = new AudioContext();
                  const engine = new AudioEngine(clock);
                  try {
                    await engine.timeline.ready;
                    await clock.audioWorklet.addModule('/scripts/e2e/audio-wave-recorder.mjs');
                    let resumeTimeout;
                    await Promise.race([
                      engine.unlock(),
                      new Promise((_, reject) => {
                        resumeTimeout = setTimeout(
                          () => reject(new Error(`The ${cue} audio context did not resume`)),
                          10000,
                        );
                      }),
                    ]).finally(() => clearTimeout(resumeTimeout));
                    const recorder = new AudioWorkletNode(clock, 'e2e-wave', {
                      numberOfInputs: 1,
                      numberOfOutputs: 1,
                      outputChannelCount: [1],
                      channelCount: 2,
                      channelCountMode: 'explicit',
                    });
                    engine.testInput('sfx').connect(recorder);
                    recorder.connect(clock.destination);
                    const frame = Math.ceil(((clock.currentTime + 0.8) * clock.sampleRate) / 128) * 128;
                    const start = (frame + offset) / clock.sampleRate;
                    const recorded = new Promise((resolve, reject) => {
                      const timeout = setTimeout(
                        () => reject(new Error(`The ${cue} waveform was not recorded`)),
                        15000,
                      );
                      recorder.port.onmessage = ({ data }) => {
                        clearTimeout(timeout);
                        resolve(data);
                      };
                      recorder.onprocessorerror = () => {
                        clearTimeout(timeout);
                        reject(new Error('The waveform recorder stopped'));
                      };
                    });
                    recorder.port.postMessage({
                      from: frame - 128,
                      length: Math.ceil(1.4 * clock.sampleRate),
                    });
                    const handle = engine.play(cue, { at: start });
                    let timeout;
                    const ack = await Promise.race([
                      handle.started,
                      new Promise((_, reject) => {
                        timeout = setTimeout(
                          () => reject(new Error(`The ${cue} start was not acknowledged`)),
                          15000,
                        );
                      }),
                    ]).finally(() => clearTimeout(timeout));
                    if (Math.abs(ack.start - start) > 1 / clock.sampleRate)
                      throw new Error(`${cue} started after the capture window`);
                    const data = await recorded;
                    return { ...data, rate: clock.sampleRate, frame };
                  } finally {
                    engine.dispose();
                    if (clock.state !== 'closed')
                      await new Promise((resolve) =>
                        clock.addEventListener(
                          'statechange',
                          () => {
                            if (clock.state === 'closed') resolve();
                          },
                          { once: true },
                        ),
                      );
                  }
                };
                const live = await capture(cue, true, offset);
                const native = await capture(cue, false, offset, live.rate);
                if (native.rate !== live.rate) throw new Error('The sample rates changed');
                let signal = 0;
                let error = 0;
                let dot = 0;
                let actual = 0;
                for (const ch of ['left', 'right'])
                  for (let i = 0; i < native[ch].length; i++) {
                    const a = native[ch][i];
                    const b = live[ch][i];
                    signal += a * a;
                    actual += b * b;
                    error += (a - b) ** 2;
                    dot += a * b;
                  }
                const windows = [];
                for (const [from, to] of [
                  [0, 0.08],
                  [0.1, 0.4],
                ]) {
                  let reference = 0;
                  let delta = 0;
                  for (
                    let i = 165 + Math.floor(from * native.rate);
                    i < 165 + Math.floor(to * native.rate);
                    i++
                  ) {
                    reference += native.left[i] ** 2;
                    delta += (native.left[i] - live.left[i]) ** 2;
                  }
                  windows.push(Math.sqrt(delta / reference));
                }
                let before = 0;
                for (let i = 0; i < 128 + Math.ceil(offset); i++)
                  before = Math.max(before, Math.abs(live.left[i]), Math.abs(live.right[i]));
                const onset = [native, live].map((data) =>
                  data.left.findIndex((sample) => Math.abs(sample) > 1e-7),
                );
                const samples =
                  cue === '__phase_sine'
                    ? [native, live].map((data) => [
                        ...data.left.slice(128 + Math.ceil(offset) - 1, 128 + Math.ceil(offset) + 10),
                      ])
                    : [];
                return {
                  cue,
                  offset,
                  difference: Math.sqrt(error / signal),
                  correlation: dot / Math.sqrt(signal * actual),
                  windows,
                  before,
                  onset,
                  samples,
                  frames: [native.frame, live.frame],
                  rate: live.rate,
                };
              },
              { cue, offset },
            );
            results.push(result);
            note(h, 'waveform', result);
            h.expect(!errors.length, errors.join('\n'));
          } finally {
            await ctx.close();
          }
        }
      h.expect(
        results.every((r) => r.before === 0),
        `A cue sounded before its start: ${JSON.stringify(results.filter((r) => r.before !== 0))}`,
      );
      h.expect(
        results.every((r) => r.difference < 0.01),
        `Live cue waveforms differ from offline playback: ${JSON.stringify(results)}`,
      );
      return results;
    },
    async 'live-oscillator-control-starts-on-one-frame'(h) {
      const results = [];
      for (let run = 0; run < 6; run++) {
        const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
        try {
          await page.waitForFunction(() => window.__lab === true);
          const result = await page.evaluate(async () => {
            const { AudioEngine } = await import('/src/audio/engine.ts');
            const { CUES } = await import('/src/audio/cues.ts');
            const { TimelineNode } = await import('/src/audio/timeline.ts');
            CUES.__phase_sine = {
              timeline: true,
              fn: (voice) => voice.osc('sine', 880, voice.t, voice.t + 1, voice.wet),
            };
            const original = TimelineNode.prototype.moment;
            const limit = (promise, name) => {
              let timeout;
              return Promise.race([
                promise,
                new Promise((_, reject) => {
                  timeout = setTimeout(() => reject(new Error(`${name} timed out`)), 15000);
                }),
              ]).finally(() => clearTimeout(timeout));
            };
            try {
              const clock = new AudioContext();
              const engine = new AudioEngine(clock);
              try {
                await engine.timeline.ready;
                await clock.audioWorklet.addModule('/scripts/e2e/audio-wave-recorder.mjs');
                await limit(engine.unlock(), 'Audio resume');
                const audio = new AudioWorkletNode(clock, 'e2e-wave', {
                  numberOfInputs: 1,
                  numberOfOutputs: 1,
                  outputChannelCount: [1],
                  channelCount: 2,
                  channelCountMode: 'explicit',
                });
                engine.testInput('sfx').connect(audio);
                audio.connect(clock.destination);
                const frame = Math.ceil(((clock.currentTime + 0.8) * clock.sampleRate) / 128) * 128;
                const start = (frame + 37.25) / clock.sampleRate;
                const record = (node) => {
                  const ready = new Promise((resolve, reject) => {
                    node.port.onmessage = ({ data }) => resolve(data);
                    node.onprocessorerror = () => reject(new Error('The recorder stopped'));
                  });
                  node.port.postMessage({ from: frame - 128, length: 512 });
                  return ready;
                };
                const output = record(audio);
                let control;
                let raw;
                let oscillator;
                let intrinsic;
                const makeOscillator = clock.createOscillator.bind(clock);
                clock.createOscillator = () => (oscillator = makeOscillator());
                TimelineNode.prototype.moment = function (requested, events) {
                  const frequency = events.find((event) => event.kind === 'align').channel;
                  const gate = events.find((event) => event.kind === 'set' && event.value === 1).channel;
                  const split = clock.createChannelSplitter(32);
                  const merge = clock.createChannelMerger(2);
                  const probe = new AudioWorkletNode(clock, 'e2e-wave', {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [1],
                    channelCount: 2,
                    channelCountMode: 'explicit',
                  });
                  this.node.connect(split);
                  split.connect(merge, frequency, 0);
                  split.connect(merge, gate, 1);
                  merge.connect(probe);
                  probe.connect(clock.destination);
                  control = record(probe);
                  const rawProbe = new AudioWorkletNode(clock, 'e2e-wave', {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [1],
                    channelCount: 2,
                    channelCountMode: 'explicit',
                  });
                  oscillator.connect(rawProbe);
                  rawProbe.connect(clock.destination);
                  raw = record(rawProbe);
                  intrinsic = oscillator.frequency.value;
                  return original.call(this, requested, events);
                };
                const handle = engine.play('__phase_sine', { at: start });
                const ack = await limit(handle.started, 'Cue acknowledgement');
                const [sound, signals, waveform] = await limit(
                  Promise.all([output, control, raw]),
                  'Waveform recording',
                );
                const first = (data) => data.findIndex((value) => Math.abs(value) > 1e-7);
                return {
                  frame,
                  start,
                  ack: ack.start,
                  frequency: first(signals.left),
                  gate: first(signals.right),
                  audio: first(sound.left),
                  raw: first(waveform.left),
                  intrinsic,
                  values: [...sound.left.slice(164, 170)],
                  rawValues: [...waveform.left.slice(164, 170)],
                };
              } finally {
                TimelineNode.prototype.moment = original;
                engine.dispose();
                if (clock.state !== 'closed')
                  await new Promise((resolve) =>
                    clock.addEventListener(
                      'statechange',
                      () => {
                        if (clock.state === 'closed') resolve();
                      },
                      { once: true },
                    ),
                  );
              }
            } finally {
              TimelineNode.prototype.moment = original;
            }
          });
          results.push(result);
          note(h, 'phase-control', result);
          h.expect(!errors.length, errors.join('\n'));
        } finally {
          await ctx.close();
        }
      }
      h.expect(
        results.every((r) => r.frequency === 166 && r.gate === 166 && r.audio === 167),
        JSON.stringify(results),
      );
      return results;
    },
  };
}
