import { audioReady, audioRecorded, audioHeard, captureEngine } from './audio-recorder.mjs';

async function silence(page, tap) {
  const after = await page.evaluate(async () => {
    const { soon } = await import('/src/audio/param.ts');
    const { stoppedBy } = await import('/src/audio/voice.ts');
    const e = window.__engine;
    const at = soon(e.ctx);
    e.stopAll(0.005, at);
    return stoppedBy(at, 0.005);
  });
  await page.waitForFunction(([tap, after]) => {
    const r = window.__taps[tap];
    return (r.end - 16) * 128 / r.context.sampleRate > after &&
      [...r.q].filter(([k]) => k >= r.end - 16).every(([, [p]]) => p < 1e-6);
  }, [tap, after]);
}

export async function pendingStops(h, { ctx, page, errors, tap }) {
  try {
    await captureEngine(page);
    await silence(page, tap);
    tap = await page.evaluate(() => {
      const e = window.__engine;
      window.__pendingOutput = e.ctx.createGain();
      window.__pendingOutput.connect(e.ctx.destination);
      return window.__taps.length - 1;
    });
    await audioReady(page);
    const rows = [];
    for (const kind of ['bed', 'charge', 'cue', 'music', 'section']) {
      for (const phase of ['build', 'gate']) {
        const r = await page.evaluate(async ([kind, phase]) => {
          const { Voice, stoppedBy } = await import('/src/audio/voice.ts');
          const e = window.__engine;
          const osc = Voice.prototype.osc;
          const open = Voice.prototype.openInTime;
          const make = e.ctx.createConstantSource;
          const set = AudioParam.prototype.setValueAtTime;
          const gates = new WeakSet();
          let stalled = false;
          let probed = false;
          const stall = () => {
            if (stalled) return;
            stalled = true;
            const until = e.now + 0.35;
            while (e.now < until);
          };
          e.ctx.createConstantSource = function () {
            const node = make.call(this);
            gates.add(node.offset);
            return node;
          };
          Voice.prototype.osc = function (...args) {
            if (phase === 'build') stall();
            return osc.apply(this, args);
          };
          Voice.prototype.openInTime = function (...args) {
            if (!probed) {
              probed = true;
              this.link(this.out, window.__pendingOutput);
            }
            return open.apply(this, args);
          };
          AudioParam.prototype.setValueAtTime = function (value, at) {
            const result = set.call(this, value, at);
            if (phase === 'gate' && value === 1 && gates.has(this)) stall();
            return result;
          };
          const from = e.now;
          window.__watch = true;
          try {
            const cue = kind === 'section' ? 'music' : kind;
            const last = cue === 'cue' ? 'stop' :
              kind === 'section' ? 'music' : cue + '_stop';
            e.schedule([
              { t: 0, cue: cue === 'cue' ? 'bubble' : cue, loop: { name: 'gate_hum' },
                opts: { id: 'pending', section: 'awaken', fade: 0.005 } },
              { t: 0.08, cue: last, loop: { name: 'gate_hum' },
                opts: { id: 'pending', section: 'calm', fade: 0.005, fadeOut: 0.005, ramp: 0.005 } },
            ], from);
          } finally {
            window.__watch = false;
            window.__stall = null;
            Voice.prototype.osc = osc;
            Voice.prototype.openInTime = open;
            e.ctx.createConstantSource = make;
            AudioParam.prototype.setValueAtTime = set;
          }
          return { kind, phase, from, silentAt: stoppedBy(from + 0.08, 0.005), to: e.now + 0.3, stalled };
        }, [kind, phase]);
        await audioRecorded(page, tap, r.to);
        const heard = await audioHeard(page, tap, r.silentAt + 0.01, r.to, [1e-6, 1e-6]);
        rows.push({ ...r, heard });
        await silence(page, tap);
      }
    }
    for (const r of rows) {
      h.expect(r.stalled, `${r.kind}: the ${r.phase} never stalled`);
      h.expect(r.heard.cover === 1 && r.heard.peak < 1e-6,
        `${r.kind}: a stopped ${r.phase} was heard: ${JSON.stringify(r.heard)}`);
    }
    h.expect(!errors.length, errors.join('\n'));
    return rows;
  } finally {
    await ctx.close();
  }
}

export async function explicitHitGate(h, { ctx, page, errors, tap }, phase = 'hit') {
  try {
    await captureEngine(page);
    await silence(page, tap);
    await page.waitForFunction(() => window.__engine.now >= 1);
    const r = await page.evaluate(async (phase) => {
      const { Voice } = await import('/src/audio/voice.ts');
      const e = window.__engine;
      const hitAt = e.now + 0.05;
      e.music.host.hush = () => {};
      e.music.to('awaken', 0.01, { at: e.now, hitAt });
      const at = Math.max(hitAt, e.now + 0.05);
      const next = e.music.copies('awaken_hit').ready[0].voice;
      const original = next.riders[0];
      const scheduled = !original.isHeld && original.t >= e.now;
      const place = Voice.prototype.place;
      let stalled = false;
      Voice.prototype.place = function (...args) {
        if (!stalled && this.clock === (phase === 'hit' ? next : original)) {
          stalled = true;
          const until = e.now + 0.35;
          while (e.now < until);
        }
        return place.apply(this, args);
      };
      const warn = console.warn;
      const warnings = [];
      console.warn = function (...args) {
        warnings.push(args);
        warn.apply(this, args);
      };
      let hit;
      try {
        hit = e.play('awaken_hit', { at });
      } finally {
        Voice.prototype.place = place;
        console.warn = warn;
      }
      window.__firstRoar = original;
      return { at, to: e.now + 0.4, stalled, scheduled, warnings, hitEnd: hit.end,
        hitDropped: e.active.size === 0, roarStopped: original.isStopped };
    }, phase);
    await audioRecorded(page, tap, r.to);
    const lost = await audioHeard(page, tap, r.at, r.to, [1e-6, 1e-6]);
    h.expect(r.stalled && r.hitDropped, `the hit did not drop: ${JSON.stringify(r)}`);
    h.expect(!r.scheduled && r.roarStopped && lost.cover === 1 && lost.peak < 1e-6,
      `the explicit roar survived its dropped hit: ${JSON.stringify({ ...r, lost })}`);
    h.expect(r.warnings.some((w) => w[0] === '[audio] sound dropped' && w[1] === 'awaken_hit' && w[2] > 250),
      `the drop was not reported with its sound and lateness: ${JSON.stringify(r.warnings)}`);
    const retry = await page.evaluate(async () => {
      const e = window.__engine;
      const at = e.now + 0.1;
      const roar = e.music.copies('awaken_hit')?.ready[0]?.voice.riders[0];
      const hit = e.play('awaken_hit', { at }).voice;
      return { at, fresh: !!roar && roar !== window.__firstRoar, opened: !!roar && !roar.isHeld && !roar.isStopped,
        shared: hit?.gate === roar?.gate && hit?.openedAt === roar?.openedAt };
    });
    await audioRecorded(page, tap, retry.at + 0.3);
    const heard = await audioHeard(page, tap, retry.at + 0.05, retry.at + 0.3, [1e-6, 1e-6]);
    h.expect(retry.fresh && retry.opened && retry.shared && heard.rms > 1e-4,
      `the next hit did not bring a new roar: ${JSON.stringify({ ...retry, heard })}`);
    h.expect(!errors.length, errors.join('\n'));
    return { ...r, lost, retry, heard };
  } finally {
    await ctx.close();
  }
}

export async function pendingHandleStops(h, { ctx, page, errors, tap }) {
  try {
    await captureEngine(page);
    tap = await page.evaluate(() => {
      const e = window.__engine;
      e.stopAll(0.005);
      window.__pendingOutput = e.ctx.createGain();
      window.__pendingOutput.connect(e.ctx.destination);
      return window.__taps.length - 1;
    });
    await audioReady(page);
    await page.waitForFunction((tap) => {
      const r = window.__taps[tap];
      return [...r.q].filter(([k]) => k >= r.end - 16).every(([, [p]]) => p < 1e-6);
    }, tap);
    const rows = [];
    for (const kind of ['bed', 'charge']) for (const phase of ['build', 'placement']) {
      for (const duration of [0.08, 0.7]) {
        const r = await page.evaluate(async ([kind, duration, phase]) => {
          const { Voice, stoppedBy } = await import('/src/audio/voice.ts');
          const { Prebuilt, openPrebuilt } = await import('/src/audio/prebuild.ts');
          const { buildBed, buildCharge } = await import('/src/audio/beds.ts');
          const e = window.__engine;
          const open = Voice.prototype.openInTime;
          const tries = [];
          let builds = 0;
          let pending;
          const silent = e.ctx.createGain();
          const lib = { ...e.lib, room: silent, hall: silent };
          const from = e.now;
          const stopAt = from + duration;
          Voice.prototype.openInTime = function (...args) {
            if (!tries.length) {
              if (phase === 'placement') {
                if (kind === 'bed') pending.stop(0.005, stopAt);
                else pending.stop(stopAt, 0.005);
              }
              window.__stall = { after: 'start', by: 0.35 };
            }
            const kept = open.apply(this, args);
            tries.push(kept);
            return kept;
          };
          window.__watch = true;
          let voice;
          try {
            ({ voice } = openPrebuilt(from, new Prebuilt((seed) => {
              const built = kind === 'bed' ? buildBed(lib, 'gate_hum', window.__pendingOutput, 1, 0.005, seed()) :
                buildCharge(lib, window.__pendingOutput, seed());
              pending ??= built.handle;
              if (!builds++ && phase === 'build') {
                if (kind === 'bed') built.handle.stop(0.005, stopAt);
                else built.handle.stop(stopAt, 0.005);
              }
              return built;
            }, () => 7, 'continuous')));
          } finally {
            window.__watch = false;
            window.__stall = null;
            Voice.prototype.openInTime = open;
          }
          const silentAt = stoppedBy(stopAt, 0.005);
          return { kind, duration, phase, from, stopAt, silentAt, to: Math.max(e.now, silentAt) + 0.2,
            tries, endedAt: voice.silentAt };
        }, [kind, duration, phase]);
        await audioRecorded(page, tap, r.to);
        const after = await audioHeard(page, tap, r.silentAt + 0.01, r.to, [1e-6, 1e-6]);
        const before = await audioHeard(page, tap, r.from, r.stopAt, [1e-6, 1e-6]);
        rows.push({ ...r, before, after });
      }
    }
    for (const r of rows) {
      h.expect(r.tries[0] === false, `${r.kind}: the first opening did not stall`);
      if (r.duration < 0.35) {
        h.expect(r.tries.every((kept) => !kept), `${r.kind}: a stopped handle reopened`);
      } else {
        h.expect(r.tries.some(Boolean) && r.before.rms > 1e-4, `${r.kind}: the remaining sound was lost`);
        h.expect(Math.abs(r.endedAt - r.silentAt) < 1e-6, `${r.kind}: retry moved the handle's stop`);
      }
      h.expect(r.after.cover === 1 && r.after.peak < 1e-6,
        `${r.kind}: a handle stop was lost: ${JSON.stringify(r)}`);
    }
    h.expect(!errors.length, errors.join('\n'));
    return rows;
  } finally {
    await ctx.close();
  }
}

export async function slowCueStop(h, { ctx, page, errors, tap }) {
  try {
    await captureEngine(page);
    await silence(page, tap);
    tap = await page.evaluate(() => {
      const e = window.__engine;
      window.__pendingOutput = e.ctx.createGain();
      window.__pendingOutput.connect(e.ctx.destination);
      return window.__taps.length - 1;
    });
    await audioReady(page);
    const r = await page.evaluate(async () => {
      const { Voice, stoppedBy } = await import('/src/audio/voice.ts');
      const e = window.__engine;
      const method = Voice.prototype.openInTime ? 'openInTime' : 'open';
      const open = Voice.prototype[method];
      let stalled = false;
      Voice.prototype[method] = function (...args) {
        const result = open.apply(this, args);
        if (!stalled) {
          this.out.connect(window.__pendingOutput);
          stalled = true;
          const until = e.now + 0.35;
          while (e.now < until);
        }
        return result;
      };
      const from = e.now;
      try {
        e.schedule([
          { t: 0, cue: 'bubble', opts: { id: 'pending' } },
          { t: 0.08, cue: 'stop', opts: { id: 'pending', ramp: 0.005 } },
        ], from);
      } finally {
        Voice.prototype[method] = open;
      }
      return { from, silentAt: stoppedBy(from + 0.08, 0.005), to: e.now + 0.3, stalled };
    });
    await audioRecorded(page, tap, r.to);
    const heard = await audioHeard(page, tap, r.silentAt + 0.01, r.to, [1e-6, 1e-6]);
    h.expect(r.stalled && heard.cover === 1 && heard.peak < 1e-6,
      `the expired cue sounded after its build: ${JSON.stringify({ ...r, heard })}`);
    h.expect(!errors.length, errors.join('\n'));
    return { ...r, heard };
  } finally {
    await ctx.close();
  }
}

export async function pendingLevels(h, { ctx, page, errors, tap }) {
  try {
    await captureEngine(page);
    await silence(page, tap);
    const rows = [];
    for (const kind of ['bed', 'charge', 'music']) {
      const r = await page.evaluate(async (kind) => {
        const { Voice } = await import('/src/audio/voice.ts');
        const e = window.__engine;
        const osc = Voice.prototype.osc;
        const tones = [];
        let stalled = false;
        Voice.prototype.osc = function (...args) {
          if (!stalled) {
            stalled = true;
            const until = e.now + 0.35;
            while (e.now < until);
          }
          const node = osc.apply(this, args);
          if (Math.abs(args[1] - 293.6647679174) < 0.01) tones.push(node);
          return node;
        };
        const from = e.now;
        try {
          const events = kind === 'bed' ? [
            { t: 0, cue: 'bed', loop: { name: 'gate_hum', level: 1 }, opts: { fade: 0.005 } },
            { t: 0.08, cue: 'bed', loop: { name: 'gate_hum', level: 0 }, opts: { fade: 0.005 } },
          ] : kind === 'charge' ? [
            { t: 0, cue: 'charge', opts: { c: 1 } },
            { t: 0.08, cue: 'charge_release' },
          ] : [
            { t: 0, cue: 'music', opts: { section: 'calm', fade: 0.005 } },
            { t: 0.08, cue: 'music_level', opts: { v: 0.4, ramp: 0.005 } },
            { t: 0.08, cue: 'music_lowpass', opts: { hz: 400, ramp: 0.005 } },
            { t: 0.08, cue: 'music_lift', opts: { db: -5, ramp: 0.005 } },
          ];
          e.schedule(events, from);
        } finally {
          Voice.prototype.osc = osc;
        }
        window.__controlledTones = tones;
        return { kind, from, to: e.now + 0.3, stalled };
      }, kind);
      await audioRecorded(page, tap, r.to);
      const levels = await page.evaluate(() => {
        const e = window.__engine;
        return { tones: window.__controlledTones.map((node) => node.frequency.value),
          music: e.mlevel.gain.value, lowpass: e.mlp.frequency.value, lift: e.shelf.gain.value };
      });
      const heard = await audioHeard(page, tap, r.to - 0.1, r.to, [1e-6, 1e-6]);
      rows.push({ ...r, levels, heard });
      await silence(page, tap);
    }
    for (const r of rows) {
      h.expect(r.stalled, `${r.kind}: the build never stalled`);
      if (r.kind === 'bed') h.expect(r.heard.cover === 1 && r.heard.peak < 1e-6,
        `the held bed lost its level change: ${JSON.stringify(r)}`);
      if (r.kind === 'charge') h.expect(r.levels.tones.length >= 2 &&
        r.levels.tones.every((frequency) => Math.abs(frequency - 293.6647679174) < 0.01) && r.heard.rms > 1e-5,
      `the held charge lost its release: ${JSON.stringify(r)}`);
      if (r.kind === 'music') h.expect(Math.abs(r.levels.music - 0.4) < 1e-5 &&
        Math.abs(r.levels.lowpass - 400) < 0.01 && Math.abs(r.levels.lift + 5) < 1e-5 && r.heard.rms > 1e-5,
      `the held score lost its controls: ${JSON.stringify(r)}`);
    }
    h.expect(!errors.length, errors.join('\n'));
    return rows;
  } finally {
    await ctx.close();
  }
}

export async function riderStop(h, { ctx, page, errors }) {
  try {
    await captureEngine(page);
    const r = await page.evaluate(async () => {
      const { Voice, LONG, stoppedBy } = await import('/src/audio/voice.ts');
      const { Prebuilt, openPrebuilt } = await import('/src/audio/prebuild.ts');
      const e = window.__engine;
      e.stopAll(0.005);
      const outputs = [e.ctx.createGain(), e.ctx.createGain()];
      const taps = outputs.map((output) => {
        output.connect(e.ctx.destination);
        return window.__taps.length - 1;
      });
      const silent = e.ctx.createGain();
      const lib = { ...e.lib, room: silent, hall: silent };
      window.__orderedGain = outputs[0].gain;
      const open = Voice.prototype.openInTime;
      const tries = [];
      Voice.prototype.openInTime = function (...args) {
        if (!tries.length) window.__stall = { after: 'start', by: 0.1 };
        const kept = open.apply(this, args);
        tries.push(kept);
        return kept;
      };
      const from = e.now;
      const stopAt = from + 0.7;
      let builds = 0;
      window.__watch = true;
      try {
        openPrebuilt(from, new Prebuilt(() => {
          const voice = new Voice(lib, 0, outputs[0], { held: true });
          const rider = new Voice(lib, 0, outputs[1], { held: true });
          const level = (target, at, value) => target.control(at,
            (time) => outputs[0].gain.setValueAtTime(value, time), (built, time) => level(built.voice, time, value));
          if (!builds) {
            level(rider, from + 0.2, 0.3);
            level(voice, from + 0.1, 0.2);
            level(voice, from + 0.2, 0.5);
          }
          voice.ride(rider);
          voice.osc('sine', 440, 0, LONG, voice.gain(0.05, voice.dry));
          rider.osc('sine', 660, 0, LONG, rider.gain(0.05, rider.dry));
          if (!builds++) rider.stop(stopAt, 0.005);
          return { voice };
        }, () => 7));
      } finally {
        window.__watch = false;
        window.__stall = null;
        Voice.prototype.openInTime = open;
      }
      return { taps, tries, after: stoppedBy(stopAt, 0.005) + 0.02, to: stopAt + 0.3 };
    });
    await audioReady(page);
    const heard = [];
    for (const tap of r.taps) {
      await audioRecorded(page, tap, r.to);
      heard.push(await audioHeard(page, tap, r.after, r.to, [1e-6, 1e-6]));
    }
    h.expect(r.tries[0] === false && r.tries.some(Boolean), 'the held pair never rebuilt');
    const level = await page.evaluate(() => window.__orderedGain.value);
    h.expect(Math.abs(level - 0.5) < 1e-6, `the rebuilt pair reordered its controls: ${level}`);
    h.expect(heard[0].cover === 1 && heard[0].rms > 0.01 && heard[1].cover === 1 && heard[1].peak < 1e-6,
      `the rebuilt pair moved its stop to the other sound: ${JSON.stringify({ ...r, heard })}`);
    h.expect(!errors.length, errors.join('\n'));
    return { ...r, heard };
  } finally {
    await ctx.close();
  }
}

export async function existingStops(h, { ctx, page, errors }) {
  try {
    await captureEngine(page);
    const rows = [];
    for (const kind of ['bed', 'charge', 'cue', 'music']) {
      const prepared = await page.evaluate((kind) => {
        const e = window.__engine;
        e.stopAll(0.005);
        let voice;
        if (kind === 'bed') voice = e.bed('gate_hum', { fadeIn: 0.005 }).voice;
        else if (kind === 'charge') voice = e.chargeLoop().voice;
        else if (kind === 'music') {
          e.music.to('calm', 0.005);
          voice = e.music.live.at(-1).voice;
        } else {
          e.schedule([{ t: 0, cue: 'breath_out', opts: { id: 'existing', dur: 4 } }], e.now);
          voice = [...e.active].at(-1);
        }
        const output = e.ctx.createGain();
        voice.out.connect(output);
        output.connect(e.ctx.destination);
        window.__existingVoice = voice;
        return { tap: window.__taps.length - 1, ready: e.now + 0.25 };
      }, kind);
      await audioReady(page);
      await audioRecorded(page, prepared.tap, prepared.ready);
      const before = await audioHeard(page, prepared.tap, prepared.ready - 0.1, prepared.ready, [1e-6, 1e-6]);
      const r = await page.evaluate(async (kind) => {
        const { Voice, stoppedBy } = await import('/src/audio/voice.ts');
        const e = window.__engine;
        const osc = Voice.prototype.osc;
        let stalled = false;
        Voice.prototype.osc = function (...args) {
          if (!stalled) {
            stalled = true;
            const until = e.now + 0.35;
            while (e.now < until);
          }
          return osc.apply(this, args);
        };
        const from = e.now;
        try {
          const cue = kind === 'cue' ? 'stop' : kind + '_stop';
          e.schedule([
            { t: 0, cue: 'soft_chime' },
            { t: 0.08, cue, loop: { name: 'gate_hum' }, opts: { id: 'existing', fade: 0.005, ramp: 0.005 } },
          ], from);
        } finally {
          Voice.prototype.osc = osc;
        }
        return { kind, stalled, after: stoppedBy(from + 0.08, 0.005) + 0.01, to: e.now + 0.2 };
      }, kind);
      await audioRecorded(page, prepared.tap, r.to);
      rows.push({ ...r, before, heard: await audioHeard(page, prepared.tap, r.after, r.to, [1e-6, 1e-6]) });
    }
    for (const r of rows) {
      h.expect(r.stalled && r.before.rms > 1e-5, `${r.kind}: the running sound was never heard before the stall`);
      h.expect(r.heard.cover === 1 && r.heard.peak < 1e-6,
        `${r.kind}: an unrelated build delayed its stop: ${JSON.stringify(r)}`);
    }
    h.expect(!errors.length, errors.join('\n'));
    return rows;
  } finally {
    await ctx.close();
  }
}
