// Record on the audio thread: a busy page delays delivery, but cannot overwrite an unread quantum.

export async function installAudioRecorder(ctx) {
  await ctx.addInitScript(() => {
    const WORKLET = 'scripts/e2e/audio-recorder-worklet.mjs';
    const connect = AudioNode.prototype.connect;
    const modules = new WeakMap();
    const taps = (window.__taps = []);
    AudioNode.prototype.connect = function (dest, ...rest) {
      const out = connect.call(this, dest, ...rest);
      if (dest instanceof AudioDestinationNode && this.context instanceof AudioContext && !taps.some((t) => t.node === this)) {
        const context = this.context;
        const tap = { node: this, context, from: this.constructor.name, url: null, status: 'loading', q: new Map(), start: undefined, end: undefined, error: null };
        taps.push(tap);
        try { tap.url = new URL(WORKLET, document.baseURI).href; }
        catch (e) {
          tap.error = `worklet ${WORKLET} against ${document.baseURI}: ${e.message} (context ${context.state})`;
          return out;
        }
        if (!modules.has(context)) modules.set(context, context.audioWorklet.addModule(tap.url));
        modules.get(context).then(() => {
          tap.status = 'loaded';
          const node = new AudioWorkletNode(context, 'e2e-recorder', { numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
          node.port.onmessage = ({ data }) => {
            for (const [i, ...levels] of data) {
              tap.status = 'recording';
              tap.q.set(i, levels);
              tap.start ??= i;
              tap.end = i;
            }
          };
          node.onprocessorerror = () => (tap.error = `worklet ${tap.url}: processor failed (context ${context.state})`);
          connect.call(this, node);
          connect.call(node, context.destination);
        }).catch((e) => (tap.error = `worklet ${tap.url}: ${e.message} (context ${context.state})`));
      }
      return out;
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
    const taps = await page.evaluate(() => window.__taps.map((t) => ({ url: t.url, status: t.status, state: t.context.state, start: t.start, error: t.error })));
    throw new Error('audio recorder did not become ready: ' + JSON.stringify(taps), { cause });
  }
}

/** Wait for delivery through audio time t, including the final quantum of a suspended or closed context. */
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
