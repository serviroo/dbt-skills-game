// Record on the audio thread: a busy page delays delivery, but cannot overwrite an unread quantum.

export async function installAudioRecorder(ctx) {
  await ctx.addInitScript(() => {
    const WORKLET = 'scripts/e2e/audio-recorder-worklet.mjs';
    const connect = AudioNode.prototype.connect;
    const close = AudioContext.prototype.close;
    const modules = new WeakMap();
    const ending = new WeakMap();
    const taps = (window.__taps = []);
    AudioNode.prototype.connect = function (dest, ...rest) {
      const out = connect.call(this, dest, ...rest);
      if (dest instanceof AudioDestinationNode && this.context instanceof AudioContext && !taps.some((t) => t.node === this)) {
        const context = this.context;
        const tap = { node: this, context, from: this.constructor.name, url: null, status: 'loading', q: new Map(), unrendered: new Set(), posted: undefined, start: undefined, end: undefined, recorder: null, last: undefined, answered: null, error: null };
        taps.push(tap);
        try { tap.url = new URL(WORKLET, document.baseURI).href; }
        catch (e) {
          tap.error = `worklet ${WORKLET} against ${document.baseURI}: ${e.message} (context ${context.state})`;
          return out;
        }
        if (!modules.has(context)) modules.set(context, context.audioWorklet.addModule(tap.url));
        modules.get(context).then(() => {
          tap.status = 'loaded';
          const node = (tap.recorder = new AudioWorkletNode(context, 'e2e-recorder', { numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' }));
          // block n starts at frame 128 n of the context's clock, so a ramp through n there numbers each block, for an hour.
          // A ramp the audio thread first sees after its start would start late and shift every number, so it starts 50 ms
          // ahead: the audio thread renders up to 512 frames ahead of this clock, and the page paused here 1.3 ms at most at CPU ×6.
          const rate = context.sampleRate;
          const from = Math.ceil(((context.currentTime + 0.05) * rate) / 128);
          const to = from + Math.round((3600 * rate) / 128);
          const block = node.parameters.get('block');
          block.setValueAtTime(from, (from * 128) / rate);
          block.linearRampToValueAtTime(to, (to * 128) / rate);
          if (Math.round((context.currentTime * rate) / 128) >= from) tap.error = `worklet ${tap.url}: the page paused past block ${from} while numbering blocks, so every number would be late`;
          node.port.onmessage = ({ data }) => {
            if (!Array.isArray(data)) {
              tap.last = data.last;
              return tap.answered?.();
            }
            for (const [i, peak, ss, step, posted] of data) {
              // block numbers only rise: one that doesn't would overwrite a block already heard
              if (i <= tap.end) {
                tap.error ??= `worklet ${tap.url}: block ${i} came after block ${tap.end}`;
                continue;
              }
              if (tap.posted !== undefined && posted !== tap.posted + 1) tap.error ??= `worklet ${tap.url}: ${posted - tap.posted - 1} blocks before block ${i} never arrived`;
              // the processor ran for nothing between its last block and this one: blocks the clock counted in between
              // (as the context paused or woke) were never rendered, so nothing played in them
              else if (tap.end !== undefined) for (let b = tap.end + 1; b < i; b++) tap.unrendered.add(b);
              tap.posted = posted;
              tap.status = 'recording';
              tap.q.set(i, [peak, ss, step]);
              tap.start ??= i;
              tap.end = i;
            }
          };
          node.onprocessorerror = () => {
            tap.error = `worklet ${tap.url}: processor failed (context ${context.state})`;
            tap.answered?.();
          };
          connect.call(this, node);
          connect.call(node, context.destination);
        }).catch((e) => (tap.error = `worklet ${tap.url}: ${e.message} (context ${context.state})`));
      }
      return out;
    };
    // A closed context's recorders answer nothing more. So a close stops the context first, asks each recorder for the last
    // block it rendered (its answer comes after every block it posted), and closes once all have answered.
    const askEnds = async (context) => {
      const asked = taps.filter((t) => t.context === context && t.recorder && !t.error);
      if (!asked.length) return;
      await context.suspend();
      await Promise.all(asked.map((t) => new Promise((done) => {
        t.answered = done;
        t.recorder.port.postMessage(null);
      })));
    };
    AudioContext.prototype.close = async function () {
      if (this.state !== 'closed' && !ending.has(this)) {
        ending.set(this, askEnds(this).catch((e) => {
          for (const t of taps) if (t.context === this) t.error ??= `recorder could not stop its context before it closed: ${e.message}`;
        }));
      }
      await ending.get(this);
      return close.call(this);
    };
  });
}

export async function audioReady(page) {
  try {
    const v = await (await page.waitForFunction(() => {
      const taps = window.__taps;
      return taps.find((t) => t.error)?.error ?? (taps.length > 0 && taps.every((t) => t.start !== undefined));
    }, null, { timeout: 15000, polling: 20 })).jsonValue();
    if (v !== true) throw new Error(v);
  } catch (cause) {
    const taps = await page.evaluate(() => window.__taps.map((t) => ({
      url: t.url, status: t.status, state: t.context.state, time: t.context.currentTime,
      start: t.start, block: t.recorder?.parameters.get('block')?.value, error: t.error,
    })));
    throw new Error('audio recorder did not become ready: ' + JSON.stringify(taps), { cause });
  }
}

/** Wait for delivery through audio time t. Where a closed context's recording ends, audioEnded says. */
export async function audioRecorded(page, i, t, timeout = 15000) {
  try {
    const v = await (await page.waitForFunction(([i, t]) => {
      const tap = window.__taps[i];
      return tap.error || (tap.end !== undefined && (tap.end + 1) * 128 >= Math.round(t * tap.context.sampleRate));
    }, [i, t], { timeout, polling: 20 })).jsonValue();
    if (v !== true) throw new Error(v);
  } catch (cause) {
    const state = await page.evaluate((i) => {
      const tap = window.__taps[i];
      return { url: tap.url, status: tap.status, state: tap.context.state, end: tap.end, error: tap.error };
    }, i);
    throw new Error(`audio tap ${i} did not record through ${t} s: ${JSON.stringify(state)}`, { cause });
  }
}

/** The audio time where tap i's recording ends once its context has closed, with every block of it delivered. */
export async function audioEnded(page, i, timeout = 15000) {
  try {
    const v = await (await page.waitForFunction((i) => {
      const tap = window.__taps[i];
      if (tap.error) return { error: tap.error };
      if (tap.context.state === 'closed' && tap.last !== undefined) return { last: tap.last, end: tap.end ?? -1, rate: tap.context.sampleRate };
    }, i, { timeout, polling: 20 })).jsonValue();
    if (v.error) throw new Error(v.error);
    // the recorder's answer came after every block it reported
    if (v.end !== v.last) throw new Error(`the recorder rendered through block ${v.last} but reported only through ${v.end}`);
    return ((v.last + 1) * 128) / v.rate;
  } catch (cause) {
    const state = await page.evaluate((i) => {
      const tap = window.__taps[i];
      return { url: tap.url, status: tap.status, state: tap.context.state, end: tap.end, last: tap.last, error: tap.error };
    }, i);
    throw new Error(`audio tap ${i} has no finished recording of a closed context: ${JSON.stringify(state)}`, { cause });
  }
}

export function audioHeard(page, i, from, to, silence) {
  return page.evaluate(
    ([i, from, to, [P, R]]) => {
      const tap = window.__taps[i];
      const sr = tap.context.sampleRate;
      const Q = 128;
      const roundoff = 1e-6;
      const first = Math.ceil((from * sr) / Q - roundoff);
      const blocks = Math.max(0, Math.floor((to * sr) / Q + roundoff) - first);
      const inside = (k) => k >= first && k < first + blocks;
      const qs = [...tap.q].filter(([k]) => inside(k)).sort((x, y) => x[0] - y[0]);
      // a block the graph never rendered played nothing, so there was nothing to read
      const unrendered = [...tap.unrendered].filter(inside).length;
      let peak = 0;
      let ss = 0;
      for (const [, [p, s]] of qs) {
        peak = Math.max(peak, p);
        ss += s;
      }
      let k = qs.length;
      while (k > 0 && qs[k - 1][1][0] < P && Math.sqrt(qs[k - 1][1][1] / Q) < R) k--;
      const quietFrom = k === qs.length ? null : k === 0 ? from : (qs[k][0] * Q) / sr;
      return { rms: qs.length ? Math.sqrt(ss / (qs.length * Q)) : 0, peak, cover: blocks > unrendered ? qs.length / (blocks - unrendered) : 0, blocks, unrendered, quietFrom };
    },
    [i, from, to, silence],
  );
}

export async function watchCuts(page) {
  await page.evaluate(async () => {
    const { AudioEngine } = await import('/src/audio/engine.ts');
    const { soon } = await import('/src/audio/param.ts');
    const { SCORE } = await import('/src/motion/tokens.ts');
    let cuts = null;
    const quiet = AudioEngine.prototype.quiet;
    AudioEngine.prototype.quiet = function (on, sec, at) {
      const t = soon(this.ctx);
      at ??= t;
      if (on) cuts?.set(this.ctx, { at, placed: at, latest: t });
      return quiet.call(this, on, sec, at);
    };
    const stop = AudioScheduledSourceNode.prototype.stop;
    AudioScheduledSourceNode.prototype.stop = function (...s) {
      if (s[0] !== undefined && cuts && !cuts.has(this.context)) {
        cuts.set(this.context, { at: s[0] - SCORE.safeOutSec, placed: s[0], latest: soon(this.context) + SCORE.safeOutSec });
      }
      return stop.apply(this, s);
    };
    window.__cutsIn = (step) => {
      cuts = new Map();
      try {
        step();
        return window.__taps.map((t) => cuts.get(t.context) ?? null);
      } finally {
        cuts = null;
      }
    };
  });
}

export function cutOf(m, i = 0) {
  const cut = m.cut[i];
  if (!cut) throw new Error(`the step placed no cut on tap ${i}`);
  if (!(cut.at >= m.at[i] && cut.placed <= cut.latest)) throw new Error(`the cut on tap ${i} was placed ${((cut.at - m.at[i]) * 1000).toFixed(1)} ms after the tap, ${((cut.placed - cut.latest) * 1000).toFixed(3)} ms past where the engine places every sound`);
  return cut.at;
}
