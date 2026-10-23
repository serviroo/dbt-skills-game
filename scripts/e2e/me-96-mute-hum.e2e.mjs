import fs from 'node:fs';
import path from 'node:path';

const AUDIO = 'dbt.audio.v1';

function watchAudio() {
  const contexts = [];
  window.AudioContext = new Proxy(window.AudioContext, {
    construct(Ctor, args) {
      const ctx = Reflect.construct(Ctor, args);
      const record = { ctx, output: null, oscillators: [] };
      contexts.push(record);
      const createGain = ctx.createGain.bind(ctx);
      ctx.createGain = () => {
        const gain = createGain();
        const connect = gain.connect.bind(gain);
        gain.connect = (destination, ...ports) => {
          const result = connect(destination, ...ports);
          if (destination === ctx.destination) record.output = gain;
          return result;
        };
        return gain;
      };
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
  window.__humAudio = () => contexts
    .filter(({ oscillators }) => oscillators.length === 4 &&
      oscillators.every(({ node }, i) => Math.abs(node.frequency.value - [98, 98.6, 146.8, 196.4][i]) < 0.001))
    .map(({ ctx, output, oscillators }, i) => ({
      id: i,
      state: ctx.state,
      gain: output?.gain.value ?? null,
      activeOscillators: oscillators.filter((o) => o.started && !o.stopped).length,
    }));
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

export const scenarios = {
  async 'hum-on-while-muted'(h) {
    const { page, errors } = await openMoment(h, { muted: true });
    await turnOn(h, page);
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
