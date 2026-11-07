import { audioRecorded, audioHeard, captureEngine } from './audio-recorder.mjs';

export async function doorPath(h) {
  const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
  try {
    await page.waitForFunction(() => window.__lab === true);
    const rows = await page.evaluate(async () => {
      const { Voice } = await import('/src/audio/voice.ts');
      const { makeNoise } = await import('/src/audio/dsp.ts');
      const render = async (rate, held) => {
        const c = new OfflineAudioContext(3, 3 * rate, rate);
        const channels = c.createChannelMerger(3);
        channels.connect(c.destination);
        const output = c.createGain();
        const room = c.createGain();
        const hall = c.createGain();
        room.gain.value = 0.2;
        hall.gain.value = 0.3;
        output.connect(channels, 0, 0);
        room.connect(channels, 0, 1);
        hall.connect(channels, 0, 2);
        const noise = makeNoise(c, 13, 2, 'white');
        const lib = { ctx: c, white: noise, pink: noise, brown: noise, crackle: noise, crackleLong: noise,
          room, hall, live: false, track: () => null };
        const t = held ? 0 : 0.1;
        const v = new Voice(lib, t, output, { held, pan: 0.2, room: 0.3, hall: 0.4 }, 17);
        const g = v.gain(0, v.wet);
        v.at(g.gain).setValueAtTime(0, t);
        v.at(g.gain).linearRampToValueAtTime(0.1, t + 0.02);
        v.at(g.gain).setValueAtTime(0.1, t + 2.4);
        v.at(g.gain).linearRampToValueAtTime(0, t + 2.6);
        v.osc('sine', 293.665, t, t + 2.7, g);
        v.noise('white', t, t + 2.7, v.gain(0.1, g));
        const child = v.child(v.dry, 19);
        child.sends(0.13, 0.19);
        child.osc('triangle', 440, t, t + 2.7, child.gain(0.03, child.dry));
        if (held) {
          const open = v.openInTime;
          if (open.call(v, 0.1) === false) throw new Error('the held sound missed its offline opening');
        }
        return c.startRendering();
      };
      const out = [];
      for (const rate of [44100, 48000]) {
        const held = await render(rate, true);
        const straight = await render(rate, false);
        let changed = 0;
        let before = 0;
        let after = 0;
        let first = Infinity;
        let last = 0;
        let difference = 0;
        for (let channel = 0; channel < held.numberOfChannels; channel++) {
          const a = held.getChannelData(channel);
          const b = straight.getChannelData(channel);
          for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
              changed++;
              first = Math.min(first, i);
              last = Math.max(last, i);
              difference = Math.max(difference, Math.abs(a[i] - b[i]));
            }
            if (i > rate && i < rate * 1.1) before += a[i] * a[i];
            if (i > rate * 1.1 && i < rate * 1.2) after += a[i] * a[i];
          }
        }
        out.push({ rate, changed, before, after, first, last, difference });
      }
      return out;
    });
    for (const r of rows) {
      h.expect(r.changed === 0, `the doors changed samples: ${JSON.stringify(r)}`);
      h.expect(r.before > 0 && r.after > 0, `${r.rate} Hz: the sound did not span the door path`);
    }
    h.expect(!errors.length, errors.join('\n'));
    return rows;
  } finally {
    await ctx.close();
  }
}

export async function repeatedMisses(h, { ctx, page, errors, tap }, stall) {
  try {
    await captureEngine(page);
    const r = await page.evaluate(async ({ stall, tap }) => {
      const { Voice } = await import('/src/audio/voice.ts');
      const { SCORE } = await import('/src/motion/tokens.ts');
      const clock = window.__taps[tap].context;
      const open = Voice.prototype.openInTime;
      const osc = Voice.prototype.osc;
      const notes = new WeakMap();
      const attempts = [];
      const warnings = [];
      const warn = console.warn;
      console.warn = (...args) => warnings.push(args);
      Voice.prototype.osc = function (...args) {
        const list = notes.get(this.clock) ?? [];
        list.push(args.slice(0, 4));
        notes.set(this.clock, list);
        return osc.apply(this, args);
      };
      Voice.prototype.openInTime = function (...args) {
        const by = stall + 128 / clock.sampleRate;
        window.__stall = attempts.length < 2 ? { after: 'start', by } : null;
        const kept = open.apply(this, args);
        attempts.push({ kept: kept !== false, at: this.t, extra: args[1], notes: notes.get(this) });
        return kept;
      };
      const asked = clock.currentTime + stall;
      const previous = window.__engine.seedN;
      window.__watch = true;
      try {
        window.__engine.play('bubble', { at: asked });
      } finally {
        window.__watch = false;
        window.__stall = null;
        Voice.prototype.openInTime = open;
        Voice.prototype.osc = osc;
        console.warn = warn;
      }
      const frozen = window.__stalls.reduce((sum, s) => sum + s.to - s.from, 0);
      return { attempts, warnings, frozen, asked, late: SCORE.lateSec, behind: window.__behind,
        seed: window.__engine.seedN, expectedSeed: (previous * 1103515245 + 12345) >>> 0, lead: SCORE.leadSec };
    }, { stall, tap });
    h.expect(r.attempts.every((a, i) => a.extra === (2 ** i - 1) * r.lead),
      `retry leads were ${r.attempts.map((a) => a.extra).join(', ')}`);
    h.expect(r.attempts.length === 3, `the sound took ${r.attempts.length} tries after two placement stalls`);
    h.expect(r.attempts.slice(0, 2).every((a) => !a.kept), 'a missed sound was allowed through the doors');
    h.expect(r.attempts[2]?.kept, 'the sound did not open on the third try');
    h.expect(!r.warnings.length, 'a successful retry was reported as a dropped sound');
    const same = r.attempts.every((a) => JSON.stringify(a.notes) === JSON.stringify(r.attempts[0].notes));
    h.expect(same && r.seed === r.expectedSeed, 'rebuilding the sound changed its seed or its notes');
    const delay = r.attempts.at(-1).at - r.asked;
    h.expect(delay <= r.late, `the sound opened ${delay}s after ${r.frozen}s of stalls`);
    h.expect(!r.behind.length, `${r.behind.length} parts were placed behind the clock`);
    h.expect(!errors.length, errors.join('\n'));
    return { tries: r.attempts.length, delay, frozen: r.frozen };
  } finally {
    await ctx.close();
  }
}

export async function stalledDoorPath(h, { ctx, page, errors, tap }) {
  try {
    await captureEngine(page);
    const r = await page.evaluate(async () => {
      const { Voice } = await import('/src/audio/voice.ts');
      const e = window.__engine;
      const open = Voice.prototype.openInTime;
      let freeze;
      Voice.prototype.openInTime = function (...args) {
        const gate = this.gate?.offset;
        const set = AudioParam.prototype.setValueAtTime;
        AudioParam.prototype.setValueAtTime = function (v, at) {
          const result = set.call(this, v, at);
          if (this === gate && !freeze) {
            freeze = { from: e.now, at, value: v };
            while (e.now < freeze.from + 1.25);
            freeze.to = e.now;
          }
          return result;
        };
        try {
          return open.apply(this, args);
        } finally {
          AudioParam.prototype.setValueAtTime = set;
        }
      };
      window.__watch = true;
      try {
        window.__doorBed = e.bed('gate_hum', { level: 0.5, fadeIn: 0.01 });
      } finally {
        window.__watch = false;
        Voice.prototype.openInTime = open;
      }
      return { freeze, behind: window.__behind, at: window.__doorBed.voice.t };
    });
    await audioRecorded(page, tap, r.freeze.to);
    const levels = [];
    for (let at = r.at + 0.15; at + 0.1 < r.freeze.to; at += 0.1) {
      levels.push(await audioHeard(page, tap, at, at + 0.1, [1e-5, 1e-5]));
    }
    await page.evaluate(() => window.__doorBed.stop(0.01));
    h.expect(r.freeze.to - r.freeze.from >= 1.25, 'the door path never encountered the long stall');
    h.expect(!r.behind.length, `door operations fell behind the clock: ${JSON.stringify(r)}`);
    h.expect(levels.length > 5 && levels.every((v) => v.cover === 1 && v.rms > 1e-4),
      `the door path went silent during the stall: ${JSON.stringify({ ...r, levels })}`);
    h.expect(!errors.length, errors.join('\n'));
    return { ...r, levels };
  } finally {
    await ctx.close();
  }
}

export async function independentStops(h) {
  const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
  try {
    await page.waitForFunction(() => window.__lab === true);
    const rows = await page.evaluate(async () => {
      const { AudioEngine } = await import('/src/audio/engine.ts');
      const { Voice } = await import('/src/audio/voice.ts');
      const rows = [];
      for (const rate of [44100, 48000]) for (const first of ['hit', 'roar']) {
        const c = new OfflineAudioContext(2, 2.6 * rate, rate);
        const e = new AudioEngine(c);
        e.volume.disconnect();
        const output = c.createChannelMerger(2);
        output.connect(c.destination);
        e.testInput('sfx').connect(output, 0, 0);
        e.testInput('music').connect(output, 0, 1);
        e.music.to('awaken', 0.01, { at: 0.1 });
        const ride = Voice.prototype.ride;
        let hit;
        let roar;
        Voice.prototype.ride = function (part, ...args) {
          hit = this;
          roar = part;
          return ride.call(this, part, ...args);
        };
        try {
          e.play('awaken_hit', { at: 0.8 });
        } finally {
          Voice.prototype.ride = ride;
        }
        const stops = [];
        const stop = AudioScheduledSourceNode.prototype.stop;
        AudioScheduledSourceNode.prototype.stop = function (at) {
          if (this === hit.gate) stops.push(at);
          return stop.call(this, at);
        };
        try {
          if (first === 'hit') {
            hit.stop(1.1, 0.02);
            roar.stop(2, 0.02);
          } else {
            roar.stop(1.1, 0.02);
            hit.stop(2, 0.02);
          }
        } finally {
          AudioScheduledSourceNode.prototype.stop = stop;
        }
        const b = await c.startRendering();
        const rms = (channel, from, to) => {
          const a = b.getChannelData(channel).subarray(Math.ceil(from * rate), Math.floor(to * rate));
          return Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
        };
        rows.push({ rate, first, stops, last: Math.max(hit.silentAt, roar.silentAt),
          before: [0, 1].map((ch) => rms(ch, 0.9, 1.05)),
          between: [0, 1].map((ch) => rms(ch, 1.4, 1.6)),
          after: [0, 1].map((ch) => rms(ch, 2.3, 2.5)) });
      }
      return rows;
    });
    for (const r of rows) {
      const first = r.first === 'hit' ? 0 : 1;
      const detail = JSON.stringify(r);
      h.expect(r.before.every((v) => v > 1e-4), `the hit and roar did not open together: ${detail}`);
      h.expect(r.between[first] < 1e-5 && r.between[1 - first] > 1e-4,
        `stopping ${r.first} also stopped the other voice: ${detail}`);
      h.expect(r.after.every((v) => v < 1e-5), `a stopped voice kept playing: ${detail}`);
      h.expect(r.stops.length > 0 && r.stops.at(-1) === r.last && r.stops.every((t) => t >= r.last),
        `the shared gate stopped before its last voice: ${detail}`);
    }
    h.expect(!errors.length, errors.join('\n'));
    return rows;
  } finally {
    await ctx.close();
  }
}

export async function spareRoarGoes(h) {
  const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
  try {
    await page.waitForFunction(() => window.__lab === true);
    const r = await page.evaluate(async () => {
      const { AudioEngine } = await import('/src/audio/engine.ts');
      const { Voice } = await import('/src/audio/voice.ts');
      const c = new OfflineAudioContext(2, 2.6 * 48000, 48000);
      const e = new AudioEngine(c);
      const parts = [];
      const part = Voice.prototype.part;
      Voice.prototype.part = function (...args) {
        const p = part.apply(this, args);
        parts.push(p);
        return p;
      };
      try {
        e.music.to('awaken', 0.01, { at: 0.1 });
      } finally {
        Voice.prototype.part = part;
      }
      const spare = parts.at(-1);
      const ride = Voice.prototype.ride;
      const stop = AudioScheduledSourceNode.prototype.stop;
      const stops = [];
      let roar;
      Voice.prototype.ride = function (part, ...args) {
        roar = part;
        return ride.call(this, part, ...args);
      };
      AudioScheduledSourceNode.prototype.stop = function (at) {
        if (this === spare.gate) stops.push(at);
        return stop.call(this, at);
      };
      try {
        e.play('awaken_hit', { at: 0.8 });
      } finally {
        Voice.prototype.ride = ride;
        AudioScheduledSourceNode.prototype.stop = stop;
      }
      await c.startRendering();
      return { distinct: spare !== roar, roarOpened: roar.opened, stopped: spare.isStopped,
        cleared: spare.pending.list === null, stops, spareOpened: spare.opened };
    });
    const detail = JSON.stringify(r);
    h.expect(r.distinct && r.roarOpened, `the hit did not open a separate roar: ${detail}`);
    h.expect(r.stopped && r.cleared, `a played hit left its unused spare roar holding on: ${detail}`);
    h.expect(r.stops.length > 0 && r.stops.every((at) => at <= 0.805),
      `the unused spare roar's gate did not stop by the hit: ${detail}`);
    h.expect(!r.spareOpened, `the unused spare roar opened: ${detail}`);
    h.expect(!errors.length, errors.join('\n'));
    return r;
  } finally {
    await ctx.close();
  }
}
