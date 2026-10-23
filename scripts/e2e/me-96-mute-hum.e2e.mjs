import fs from 'node:fs';
import path from 'node:path';

const AUDIO = 'dbt.audio.v1';

function watchAudio() {
  const contexts = [];
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (destination, ...ports) {
    contexts.find(({ ctx }) => ctx === this.context)?.links.push([this, destination]);
    return connect.call(this, destination, ...ports);
  };
  window.AudioContext = new Proxy(window.AudioContext, {
    construct(Ctor, args) {
      const ctx = Reflect.construct(Ctor, args);
      const record = { ctx, links: [], oscillators: [] };
      contexts.push(record);
      const createOscillator = ctx.createOscillator.bind(ctx);
      ctx.createOscillator = () => {
        const node = createOscillator();
        const osc = { node, started: false, stopped: false };
        record.oscillators.push(osc);
        const start = node.start.bind(node);
        const stop = node.stop.bind(node);
        node.start = (...when) => {
          start(...when);
          osc.started = true;
        };
        node.stop = (...when) => {
          stop(...when);
          osc.stopped = true;
        };
        return node;
      };
      return ctx;
    },
  });
  /** The hum's output stage: the GainNodes chained into ctx.destination, last one first, and the node feeding them. */
  const outputChain = ({ ctx, links }) => {
    const gains = [];
    let node = ctx.destination;
    for (let link; (link = links.find(([from, to]) => to === node && from instanceof GainNode)); node = link[0]) gains.push(link[0]);
    return { gains, source: links.find(([, to]) => to === node)?.[0] };
  };
  // the hum's level at the speakers: the product of those gains
  const outputGain = (record) => {
    const { gains } = outputChain(record);
    return gains.length ? gains.reduce((gain, node) => gain * node.gain.value, 1) : null;
  };
  const hums = () => contexts.filter(({ oscillators }) => oscillators.length === 4 &&
    oscillators.every(({ node }, i) => Math.abs(node.frequency.value - [98, 98.6, 146.8, 196.4][i]) < 0.001));
  window.__humAudio = () => hums().map((record, i) => ({
    id: i,
    state: record.ctx.state,
    gain: outputGain(record),
    activeOscillators: record.oscillators.filter((o) => o.started && !o.stopped).length,
    time: record.ctx.currentTime,
  }));
  // runs on the audio thread: for each 128-frame render quantum, what the output stage did to the hum (output / input,
  // least squares), sent on in batches so a busy page delays the readings but never loses one
  const PROBE = `registerProcessor('hum-probe', class extends AudioWorkletProcessor {
    blocks = [];
    process([dry, wet]) {
      const a = dry[0];
      const b = wet[0];
      let dd = 0;
      let dw = 0;
      for (let i = 0; a && i < a.length; i++) {
        dd += a[i] * a[i];
        dw += a[i] * (b ? b[i] : 0);
      }
      this.blocks.push([currentTime, dd > 1e-6 ? dw / dd : null]);
      if (this.blocks.length >= 32) this.port.postMessage(this.blocks.splice(0));
      return true;
    }
  });`;
  /** Listens to the newest hum on the audio thread and keeps [seconds, gain] for every render quantum, so no change
   * goes unseen while the page is busy. `__humBlocks()` hands over and clears what has arrived. */
  window.__humProbe = async () => {
    const record = hums().at(-1);
    const { ctx } = record;
    const { gains, source } = outputChain(record);
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([PROBE], { type: 'text/javascript' })));
    const tap = new AudioWorkletNode(ctx, 'hum-probe', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1] });
    connect.call(source, tap, 0, 0);
    connect.call(gains[0], tap, 0, 1);
    connect.call(tap, ctx.destination);
    const blocks = [];
    tap.port.onmessage = ({ data }) => blocks.push(...data);
    window.__humBlocks = () => blocks.splice(0);
    window.__humHeard = () => [blocks.at(-1)?.[0] ?? -Infinity, ctx.currentTime];
  };
}

async function openMoment(h, levels = {}, query = '?reduced') {
  const { ctx, page, errors } = await h.open({
    'dbt.app.v1': h.SEEN,
    [h.YOU]: JSON.stringify({ name: '', companion: '', nameAt: 0, companionAt: 0 }),
    [h.SAVE]: JSON.stringify({ v: 1, created: 946684800000, events: [
      { id: 'previous-visit', k: 'visit', day: '2000-01-01', t: 946684800000, xp: 10 },
    ] }),
    [AUDIO]: JSON.stringify({ v: 1, master: 1, music: 1, sfx: 1, muted: false, ...levels }),
  }, query);
  ctx.setDefaultTimeout(10000);
  await ctx.addInitScript(watchAudio);
  await page.reload();
  await h.reachHub(page);
  await page.getByRole('button', { name: 'Give me a moment', exact: true }).click();
  await page.getByRole('switch', { name: 'Low hum', exact: true }).waitFor();
  h.expect((await page.evaluate(() => window.__humAudio())).length === 0, 'hum started before it was requested');
  return { ctx, page, errors };
}

async function turnOn(h, page) {
  await page.getByRole('switch', { name: 'Low hum', exact: true }).check();
  await page.waitForFunction(() => window.__humAudio().some((c) => c.state === 'running' && c.activeOscillators === 4), null, { timeout: 10000 });
  const records = await page.evaluate(() => window.__humAudio());
  h.expect(records.at(-1).gain !== null, 'no real hum GainNode reaches the audio destination');
}

async function soundControls(page) {
  const button = page.getByRole('button', { name: 'Sound settings', exact: true });
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  return page.getByRole('dialog', { name: 'Sound', exact: true });
}

async function checkGain(h, page, name, silent) {
  await page.waitForFunction((silent) => {
    const gain = window.__humAudio().at(-1)?.gain;
    return typeof gain === 'number' && (silent ? Math.abs(gain) < 0.000001 : gain > 0.001);
  }, silent, { timeout: 3000 }).catch(async (error) => {
    fs.appendFileSync(path.join(h.out, 'hum-gains.jsonl'), JSON.stringify({ name, contexts: await page.evaluate(() => window.__humAudio()) }) + '\n');
    throw error;
  });
  const samples = [];
  for (let i = 0; i < 12; i++) {
    samples.push(await page.evaluate(() => window.__humAudio()));
    await h.sleep(100);
  }
  fs.appendFileSync(path.join(h.out, 'hum-gains.jsonl'), JSON.stringify({ name, samples }) + '\n');
  h.expect(samples.every((records) => {
    const current = records.at(-1);
    return current?.state === 'running' && current.activeOscillators === 4 && current.gain !== null &&
      (silent ? Math.abs(current.gain) < 0.000001 : current.gain > 0.001);
  }), `${name}: hum output ${silent ? 'was audible' : 'was silent'}: ${JSON.stringify(samples)}`);
}

/** Records the hum's gain at every render quantum while `act` works a sound control, from about 300 ms before it to
 * over a second after, logs the trace to hum-gains.jsonl and returns it as [seconds, gain] blocks. */
async function traceAround(h, page, name, act) {
  await page.evaluate(() => window.__humBlocks());
  await h.sleep(300);
  await act();
  const after = await page.evaluate(() => window.__humHeard()[1]);
  await page.waitForFunction((after) => window.__humHeard()[0] >= after + 1.2, after, { timeout: 5000 });
  const blocks = await page.evaluate(() => window.__humBlocks());
  fs.appendFileSync(path.join(h.out, 'hum-gains.jsonl'), JSON.stringify({ name, blocks }) + '\n');
  return blocks;
}

/** After a sound control moves, the hum glides instead of stepping. In the 30 ms after the change starts at least three
 * quanta sit between the old and new level, no quantum moves more than a quarter of the change, and 200 ms after the
 * start the gain is within 5% of the new level (under 0.001 when `silent`). A `drag` keeps moving for a while, so its
 * between values may come at any point, it skips the 200 ms check and its new level is where the trace ends. */
function checkRamp(h, name, blocks, { silent = false, drag = false } = {}) {
  h.expect(blocks.length > 300 && blocks.every(([, g]) => g !== null), `${name}: short trace or no hum at the source (${blocks.length} quanta)`);
  const quantum = blocks[1][0] - blocks[0][0];
  const gap = blocks.findIndex(([t], i) => i && t - blocks[i - 1][0] > quantum * 1.5);
  h.expect(gap === -1, `${name}: the trace skipped audio at quantum ${gap}`);
  const gain = (i) => blocks[i][1];
  const mean = (list) => list.reduce((sum, [, g]) => sum + g, 0) / list.length;
  const span = Math.abs(mean(blocks.slice(-40)) - mean(blocks.slice(0, 40)));
  h.expect(span > 0.003, `${name}: the hum did not change`);
  // the change starts where the gain first moves 3% of the way within four quanta; the breath alone moves under 1%
  const start = blocks.findIndex((_, i) => i >= 4 && Math.abs(gain(i) - gain(i - 4)) > 0.03 * span);
  h.expect(start !== -1, `${name}: no change found in the hum's gain`);
  const t0 = blocks[start][0];
  const index = (ms) => blocks.findIndex(([t]) => t >= t0 + ms / 1000);
  h.expect(index(500) !== -1, `${name}: the trace ends before 500 ms after the change`);
  const detail = JSON.stringify(blocks.slice(start - 4, index(200) + 1).map(([t, g]) => [+((t - t0) * 1000).toFixed(1), +g.toPrecision(4)]));
  const from = gain(start - 4);
  // where the gain settles: the breath keeps moving it slowly, so run a line through 300..500 ms and read it at 200 ms
  const settled = () => {
    const points = blocks.slice(index(300), index(500));
    const [mt, mg] = [points.reduce((sum, [t]) => sum + t, 0) / points.length, mean(points)];
    const slope = points.reduce((sum, [t, g]) => sum + (t - mt) * (g - mg), 0) / points.reduce((sum, [t]) => sum + (t - mt) ** 2, 0);
    return mg + slope * (t0 + 0.2 - mt);
  };
  const to = silent ? 0 : drag ? mean(blocks.slice(-40)) : settled();
  const change = Math.abs(to - from);
  const between = blocks.slice(start - 3, drag ? blocks.length : index(30) + 1).filter(([, g]) => Math.abs(g - from) > 0.05 * change && Math.abs(g - to) > 0.05 * change);
  h.expect(between.length >= 3, `${name}: the gain stepped from ${from} to ${to} with ${between.length} quanta between: ${detail}`);
  const glide = blocks.slice(start - 4, drag ? blocks.length : index(200) + 1);
  const jump = Math.max(...glide.slice(1).map(([, g], i) => Math.abs(g - glide[i][1]))) / change;
  h.expect(jump < 0.25, `${name}: one quantum moved ${(jump * 100).toFixed(0)}% of the change from ${from} to ${to}: ${detail}`);
  if (drag) return;
  const landed = gain(index(200));
  h.expect(silent ? landed < 0.001 : Math.abs(landed - to) <= 0.05 * to, `${name}: ${landed} 200 ms after the change, not ${to}: ${detail}`);
}

export const scenarios = {
  async 'hum-volume-changes-ramp'(h) {
    const { page, errors } = await openMoment(h);
    await turnOn(h, page);
    await checkGain(h, page, 'before-volume-ramps', false);
    await page.evaluate(() => window.__humProbe());
    const controls = await soundControls(page);
    const button = (name) => controls.getByRole('button', { name, exact: true });
    const master = controls.getByRole('slider', { name: 'Master', exact: true });
    checkRamp(h, 'mute', await traceAround(h, page, 'mute-ramp', () => button('Mute').click()), { silent: true });
    await checkGain(h, page, 'muted-after-ramp', true);
    checkRamp(h, 'unmute', await traceAround(h, page, 'unmute-ramp', () => button('Unmute').click()));
    checkRamp(h, 'master 100 to 30', await traceAround(h, page, 'master-30-ramp', () => master.fill('30')));
    checkRamp(h, 'master 30 to 100', await traceAround(h, page, 'master-100-ramp', () => master.fill('100')));
    // a quick drag: a burst of slider moves while the breath keeps changing the hum
    const box = await master.boundingBox();
    const y = box.y + box.height / 2;
    checkRamp(h, 'master drag', await traceAround(h, page, 'master-drag-ramp', async () => {
      await page.mouse.move(box.x + box.width - 2, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.2, y, { steps: 12 });
      await page.mouse.up();
    }), { drag: true });
    h.expect(Number(await master.inputValue()) < 40, `the drag left Master at ${await master.inputValue()}`);
    await checkGain(h, page, 'after-volume-ramps', false);
    h.expect(!errors.length, errors.join('\n'));
  },

  async 'mute-while-hum-fades-in'(h) {
    const { page, errors } = await openMoment(h);
    const controls = await soundControls(page);
    const mute = controls.getByRole('button', { name: 'Mute', exact: true });
    // turn the hum on and mute in the same moment, well inside its 0.8 s fade-in
    await mute.evaluate((button, hum) => {
      hum.click();
      button.click();
    }, await page.getByRole('switch', { name: 'Low hum', exact: true }).elementHandle());
    // mute glides out over about 100 ms of played audio, so let the hum's clock pass that before listening
    await page.waitForFunction(() => window.__humAudio().some((c) => c.state === 'running' && c.activeOscillators === 4 && c.time > 0.4), null, { timeout: 10000 });
    await checkGain(h, page, 'muted-during-fade-in', true);
    await controls.getByRole('button', { name: 'Unmute', exact: true }).click();
    await checkGain(h, page, 'unmuted-after-fade-in', false);
    h.expect(!errors.length, errors.join('\n'));
  },

  async 'hum-off-mid-volume-ramp'(h) {
    const { page, errors } = await openMoment(h);
    await turnOn(h, page);
    await checkGain(h, page, 'before-off-mid-ramp', false);
    const controls = await soundControls(page);
    // move Master and turn the hum off in the same moment, so it stops while the volume is still gliding
    await controls.getByRole('slider', { name: 'Master', exact: true }).evaluate((slider, hum) => {
      slider.value = '30';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      hum.click();
    }, await page.getByRole('switch', { name: 'Low hum', exact: true }).elementHandle());
    await page.waitForFunction(() => window.__humAudio().every((c) => c.state === 'closed' && c.activeOscillators === 0), null, { timeout: 5000 });
    h.expect(!errors.length, errors.join('\n'));
  },

  async 'hum-on-while-muted'(h) {
    const { page, errors } = await openMoment(h, { muted: true });
    await turnOn(h, page);
    const first = (await page.evaluate(() => window.__humAudio())).at(-1).gain;
    h.expect(first === 0, `the hum was not silent from its first moment: ${first}`);
    await checkGain(h, page, 'hum-on-while-muted', true);
    h.expect(!errors.length, errors.join('\n'));
  },

  async 'mute-while-hum-playing'(h) {
    const { page, errors } = await openMoment(h);
    await turnOn(h, page);
    await checkGain(h, page, 'before-mute', false);
    const controls = await soundControls(page);
    await controls.getByRole('button', { name: 'Mute', exact: true }).click();
    h.expect(JSON.parse(await h.ls(page, AUDIO)).muted === true, 'mute was not persisted');
    await checkGain(h, page, 'mute-while-hum-playing', true);
    h.expect(!errors.length, errors.join('\n'));
  },

  async 'master-zero-silences-hum'(h) {
    const { page, errors } = await openMoment(h);
    await turnOn(h, page);
    await checkGain(h, page, 'before-master-zero', false);
    const controls = await soundControls(page);
    await controls.getByRole('slider', { name: 'Master', exact: true }).fill('0');
    await checkGain(h, page, 'master-zero-silences-hum', true);
    await controls.getByRole('slider', { name: 'Master', exact: true }).fill('100');
    await checkGain(h, page, 'master-restored', false);
    h.expect(!errors.length, errors.join('\n'));
  },

  async 'effects-zero-silences-hum'(h) {
    const { page, errors } = await openMoment(h);
    await turnOn(h, page);
    await checkGain(h, page, 'before-effects-zero', false);
    const controls = await soundControls(page);
    await controls.getByRole('slider', { name: 'Effects', exact: true }).fill('0');
    await checkGain(h, page, 'effects-zero-silences-hum', true);
    await controls.getByRole('slider', { name: 'Effects', exact: true }).fill('100');
    await checkGain(h, page, 'effects-restored', false);
    h.expect(!errors.length, errors.join('\n'));
  },

  async 'second-tab-mute-silences-hum'(h) {
    const { ctx, page, errors } = await openMoment(h);
    await turnOn(h, page);
    await checkGain(h, page, 'before-second-tab-mute', false);
    const second = await ctx.newPage();
    await second.goto(page.url());
    await h.reachHub(second);
    const controls = await soundControls(second);
    await controls.getByRole('button', { name: 'Mute', exact: true }).click();
    h.expect(JSON.parse(await h.ls(second, AUDIO)).muted === true, 'the second tab did not save mute');
    await page.waitForFunction(() => window.__dbtVolume.get().muted, null, { timeout: 10000 });
    await checkGain(h, page, 'second-tab-mute-silences-hum', true);
    await controls.getByRole('button', { name: 'Unmute', exact: true }).click();
    await page.waitForFunction(() => !window.__dbtVolume.get().muted, null, { timeout: 10000 });
    await checkGain(h, page, 'second-tab-unmute', false);
    h.expect(!errors.length, errors.join('\n'));
  },

  async 'unmute-restores-hum'(h) {
    const { page, errors } = await openMoment(h, { muted: true });
    await turnOn(h, page);
    const controls = await soundControls(page);
    await controls.getByRole('button', { name: 'Unmute', exact: true }).click();
    await checkGain(h, page, 'unmute-restores-hum', false);
    await controls.getByRole('button', { name: 'Mute', exact: true }).click();
    await checkGain(h, page, 'mute-again', true);
    h.expect(!errors.length, errors.join('\n'));
  },

  async 'hum-scales-with-master-and-effects'(h) {
    const { page, errors } = await openMoment(h, { master: 0.4, sfx: 0.5, music: 0 });
    await turnOn(h, page);
    await h.sleep(1500);
    const samples = [];
    for (let i = 0; i < 24; i++) {
      samples.push((await page.evaluate(() => window.__humAudio())).at(-1).gain);
      await h.sleep(100);
    }
    fs.appendFileSync(path.join(h.out, 'hum-gains.jsonl'), JSON.stringify({ name: 'scaled-hum', samples }) + '\n');
    h.expect(samples.every((g) => g >= 0.006 && g <= 0.0131), `hum did not use Master × Effects: ${samples}`);
    h.expect(!errors.length, errors.join('\n'));
  },

  async 'leaving-and-reopening-stops-hum'(h) {
    const { page, errors } = await openMoment(h);
    await turnOn(h, page);
    await checkGain(h, page, 'before-leave', false);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await h.reachHub(page);
    await page.getByRole('button', { name: 'Give me a moment', exact: true }).click();
    h.expect(!(await page.getByRole('switch', { name: 'Low hum', exact: true }).isChecked()), 'reopening enabled hum without asking');
    await page.waitForFunction(() => window.__humAudio().every((c) => c.state === 'closed' && c.activeOscillators === 0), null, { timeout: 5000 });
    await turnOn(h, page);
    await checkGain(h, page, 'reopened-hum', false);
    h.expect((await page.evaluate(() => window.__humAudio())).filter((c) => c.state === 'running').length === 1, 'an old hum context is still running');
    await page.getByRole('switch', { name: 'Low hum', exact: true }).uncheck();
    await page.waitForFunction(() => window.__humAudio().every((c) => c.state === 'closed' && c.activeOscillators === 0), null, { timeout: 5000 });
    await turnOn(h, page);
    await page.getByRole('button', { name: 'Safe Zone, help right now', exact: true }).click();
    await page.waitForFunction(() => window.__humAudio().every((c) => c.state === 'closed' && c.activeOscillators === 0), null, { timeout: 5000 });
    fs.appendFileSync(path.join(h.out, 'hum-gains.jsonl'), JSON.stringify({ name: 'after-leave', contexts: await page.evaluate(() => window.__humAudio()) }) + '\n');
    h.expect(!errors.length, errors.join('\n'));
  },

  async 'legacy-sound-off-silences-hum'(h) {
    const { page, errors } = await openMoment(h, {}, '?capture&reduced');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await h.openSettings(page);
    await page.getByRole('switch', { name: /^Sound/ }).uncheck();
    await page.getByRole('button', { name: 'Lantern', exact: true }).click();
    await h.reachHub(page);
    await page.getByRole('button', { name: 'Give me a moment', exact: true }).click();
    await turnOn(h, page);
    await checkGain(h, page, 'legacy-sound-off-silences-hum', true);
    h.expect(!errors.length, errors.join('\n'));
  },
};
