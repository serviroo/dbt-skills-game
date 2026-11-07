import { audioReady, audioRecorded, audioHeard, captureEngine } from './audio-recorder.mjs';

export async function missedAttacks(h, { ctx, page, errors }, cleanup = false) {
  try {
    await captureEngine(page);
    const tap = await page.evaluate(() => {
      const e = window.__engine;
      e.stopAll(0.005);
      window.__attackOutput = e.ctx.createGain();
      window.__attackOutput.connect(e.ctx.destination);
      return window.__taps.length - 1;
    });
    await audioReady(page);
    const rows = [];
    for (const timing of cleanup ? ['cleanup-stop', 'cleanup-disconnect'] : ['later-source', 'last-control']) {
      const r = await page.evaluate(async (timing) => {
        const { Voice, LONG } = await import('/src/audio/voice.ts');
        const e = window.__engine;
        e.music.stop(0.005);
        const osc = Voice.prototype.osc;
        const reg = Voice.prototype.reg;
        const place = Voice.prototype.place;
        const open = Voice.prototype.openInTime;
        let built = false;
        let picked;
        let started;
        let firstStarted;
        let opened;
        let stalled = false;
        const stop = AudioScheduledSourceNode.prototype.stop;
        const disconnect = AudioNode.prototype.disconnect;
        const set = AudioParam.prototype.setValueAtTime;
        const gates = new WeakSet();
        const openings = [];
        const cleanupStall = () => {
          if (stalled) return;
          stalled = true;
          stall(e.now + 0.42);
        };
        AudioScheduledSourceNode.prototype.stop = function (...args) {
          if (timing === 'cleanup-stop' && !args.length) cleanupStall();
          return stop.apply(this, args);
        };
        AudioNode.prototype.disconnect = function (...args) {
          if (timing === 'cleanup-disconnect') cleanupStall();
          return disconnect.apply(this, args);
        };
        AudioParam.prototype.setValueAtTime = function (value, at) {
          if (gates.has(this) && value === 1) openings.push({ at, now: e.now });
          return set.call(this, value, at);
        };
        const stall = (until) => { while (e.now < until); };
        Voice.prototype.osc = function (...args) {
          if (!built) {
            built = true;
            stall(e.now + 0.35);
          }
          return osc.apply(this, args);
        };
        Voice.prototype.reg = function (n, t0, t1, dest, ...args) {
          if (!picked && this.isHeld && t1 < LONG && (!timing.startsWith('cleanup') || t0 >= 0.3)) {
            picked = n;
            this.link(dest, window.__attackOutput);
          }
          return reg.call(this, n, t0, t1, dest, ...args);
        };
        Voice.prototype.place = function (s, at, offset) {
          const result = place.call(this, s, at, offset);
          if (s.transient) firstStarted ??= at;
          if (s.n === picked) {
            started = at;
            if (timing === 'later-source') {
              stall(at + 0.12);
              stalled = true;
            }
          }
          return result;
        };
        Voice.prototype.openInTime = function (...args) {
          gates.add(this.gate.offset);
          if (timing.startsWith('cleanup')) this.control(e.now, () => stall(firstStarted + 0.04));
          if (timing === 'last-control') this.control(e.now, () => {
            stall(started + 0.12);
            stalled = true;
          });
          const result = open.apply(this, args);
          opened = this.openedAt;
          return result;
        };
        try {
          e.music.to('windows', 0.005, { at: e.now });
        } finally {
          Voice.prototype.osc = osc;
          Voice.prototype.reg = reg;
          Voice.prototype.place = place;
          Voice.prototype.openInTime = open;
          AudioScheduledSourceNode.prototype.stop = stop;
          AudioNode.prototype.disconnect = disconnect;
          AudioParam.prototype.setValueAtTime = set;
        }
        return { timing, built, stalled, started, opened, openings, from: Math.max(opened, e.now),
          to: Math.max(opened, e.now) + 0.08,
          continuing: e.music.current === 'windows' };
      }, timing);
      await audioRecorded(page, tap, r.to);
      rows.push({ ...r, heard: await audioHeard(page, tap, r.from, r.to, [1e-6, 1e-6]) });
    }
    for (const r of rows) {
      h.expect(r.built && r.stalled && r.continuing && r.opened > r.started + (cleanup ? 0 : 0.12),
        `the windows score never opened past a placed attack: ${JSON.stringify(r)}`);
      h.expect(r.openings.length === 1 && r.openings.every((o) => o.at >= o.now),
        `the windows gate opened behind the clock: ${JSON.stringify(r)}`);
      h.expect(r.heard.cover === 1 && r.heard.peak < 1e-6,
        `a missed windows attack sounded through the late opening: ${JSON.stringify(r)}`);
    }
    h.expect(!errors.length, errors.join('\n'));
    return rows;
  } finally {
    await ctx.close();
  }
}

export async function stoppedParts(h) {
  const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
  try {
    await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
    const result = await page.evaluate(async () => {
      const { Voice, openBuilt } = await import('/src/audio/voice.ts');
      const { AudioEngine } = await import('/src/audio/engine.ts');
      const c = new OfflineAudioContext(1, 24000, 48000);
      const e = new AudioEngine(c);
      const parts = [];
      const ended = [];
      const { voice } = openBuilt(undefined, () => 1, () => {
        const voice = new Voice(e.lib, 0, c.destination, { held: true });
        parts.push(voice.part());
        parts.push(parts[0].part());
        for (const [i, part] of parts.entries()) {
          part.osc('sine', 440, 0, 1, part.wet);
          part.gate.onended = () => ended.push(i);
        }
        return { voice };
      });
      voice.stop(0.1, 0.005);
      const output = await c.startRendering();
      return { ended, stopped: parts.every((part) => part.isStopped),
        pending: parts.some((part) => part.pending.list !== null),
        peak: Math.max(...output.getChannelData(0).map(Math.abs)) };
    });
    h.expect(result.ended.length === 2 && result.stopped && !result.pending && result.peak === 0,
      `stopping an opened voice left an unopened part running: ${JSON.stringify(result)}`);
    h.expect(!errors.length, errors.join('\n'));
    return result;
  } finally {
    await ctx.close();
  }
}

export async function continuedSounds(h, { ctx, page, errors, tap }) {
  try {
    await captureEngine(page);
    await page.evaluate(async () => {
      const e = window.__engine;
      e.stopAll(0.005);
      const pink = e.ctx.createBuffer(1, Math.round(e.ctx.sampleRate / 8), e.ctx.sampleRate);
      pink.copyToChannel(e.lib.pink.getChannelData(0).subarray(0, pink.length), 0);
      e.lib.pink = e.libMusic.pink = pink;
      window.__loopStarts = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (at, offset, ...args) {
        if (window.__watch && this.loop) window.__loopStarts.push({ offset, duration: this.buffer.duration });
        return start.call(this, at, offset, ...args);
      };
    });
    const rows = [];
    for (const kind of ['score', 'bed', 'charge']) {
      await page.waitForFunction((tap) => {
        const r = window.__taps[tap];
        return [...r.q].filter(([k]) => k >= r.end - 16).every(([, [p]]) => p < 1e-6);
      }, tap);
      if (kind === 'score') {
        await page.evaluate(() => window.__engine.music.to('silhouette', 0.02));
        await page.waitForFunction((tap) => {
          const r = window.__taps[tap];
          return [...r.q].filter(([k]) => k >= r.end - 16).some(([, [p]]) => p > 1e-3);
        }, tap);
      }
      const r = await page.evaluate(async (kind) => {
        const { Voice } = await import('/src/audio/voice.ts');
        const e = window.__engine;
        const outgoing = e.music.live.find((s) => s.end === Infinity);
        const open = Voice.prototype.openInTime;
        const attempts = [];
        Voice.prototype.openInTime = function (...args) {
          window.__stall = { after: 'start', by: 0.35 };
          const kept = open.apply(this, args);
          attempts.push({ kept, at: this.t });
          return kept;
        };
        const was = window.__behind.length;
        const loops = window.__loopStarts.length;
        const stalls = window.__stalls.length;
        const asked = e.now;
        window.__stall = { after: 'start', by: 0.35 };
        window.__watch = true;
        try {
          if (kind === 'score') e.music.to('awaken', 0.02, { at: asked });
          else if (kind === 'bed') window.__continued = e.bed('gate_hum', { at: asked, fadeIn: 0.02 });
          else window.__continued = e.chargeLoop({ at: asked });
        } finally {
          window.__watch = false;
          window.__stall = null;
          Voice.prototype.openInTime = open;
        }
        const kept = kind === 'score' ? e.music.current === 'awaken' : !window.__continued.voice.isStopped;
        return { kind, asked, returned: e.now, attempts, kept,
          outgoingStopped: kind !== 'score' || outgoing.voice.isStopped,
          loops: window.__loopStarts.slice(loops), stalls: window.__stalls.slice(stalls),
          behind: window.__behind.slice(was) };
      }, kind);
      await audioRecorded(page, tap, r.returned + 0.9);
      const heard = await audioHeard(page, tap, r.returned + 0.3, r.returned + 0.8, [1e-5, 1e-5]);
      rows.push({ ...r, heard });
      await page.evaluate((kind) => {
        const e = window.__engine;
        if (kind === 'score') e.music.stop(0.005);
        else if (kind === 'bed') window.__continued.stop(0.005);
        else window.__continued.stop(undefined, 0.005);
      }, kind);
    }
    for (const r of rows) {
      h.expect(r.loops.some((s) => s.duration <= 0.126), `${r.kind}: the short audio loop never resumed`);
      h.expect(r.loops.every((s) => s.offset >= 0 && s.offset < s.duration),
        `${r.kind}: a resumed loop lost its offset: ${JSON.stringify(r.loops)}`);
      h.expect(r.stalls.length > 0, `${r.kind}: the opening never stalled`);
      h.expect(r.outgoingStopped, `${r.kind}: the outgoing section kept playing after the deadline`);
      h.expect(r.kept && r.heard.cover === 1 && r.heard.rms > 1e-4,
        `${r.kind}: the stalled sound was lost: ${JSON.stringify(r)}`);
      h.expect(!r.behind.length, `${r.kind}: parts fell behind the clock: ${JSON.stringify(r.behind)}`);
    }
    h.expect(!errors.length, errors.join('\n'));
    return rows;
  } finally {
    await ctx.close();
  }
}
