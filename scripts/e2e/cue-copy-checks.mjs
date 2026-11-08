async function offline(h, check) {
  const { ctx, page, errors } = await h.open({}, '?lab=audio&mute');
  try {
    await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
    await page.evaluate(async () => {
      const { Voice } = await import('/src/audio/voice.ts');
      const ride = Voice.prototype.ride;
      window.__copies = [];
      Voice.prototype.ride = function (part, ...args) {
        window.__copies.push({ hit: this, roar: part });
        return ride.call(this, part, ...args);
      };
    });
    const r = await page.evaluate(check);
    h.expect(!errors.length, errors.join('\n'));
    return r;
  } finally {
    await ctx.close();
  }
}

export async function stoppedAwakenLetsGo(h) {
  const r = await offline(h, async () => {
    const { AudioEngine } = await import('/src/audio/engine.ts');
    const c = new OfflineAudioContext(2, 2 * 48000, 48000);
    const make = c.createConstantSource.bind(c);
    const released = new WeakSet();
    c.createConstantSource = () => {
      const node = make();
      const disconnect = node.disconnect.bind(node);
      node.disconnect = (...args) => {
        released.add(node);
        return disconnect(...args);
      };
      return node;
    };
    const e = new AudioEngine(c);
    e.music.to('awaken', 0.01, { at: 0.1 });
    const built = window.__copies.length;
    e.music.stop(0.05, 1);
    e.music.scheduleUntil(1);
    await c.startRendering();
    const held = window.__copies.flatMap(({ hit, roar }) => [hit, roar])
      .filter((v) => !v.isStopped || (v.gate && !released.has(v.gate)))
      .map((v) => ({ stopped: v.isStopped, opened: v.opened, gate: !!v.gate }));
    return { built, copies: window.__copies.length, held };
  });
  const detail = JSON.stringify(r);
  h.expect(r.built > 0, `awaken built no hit copies at its opening: ${detail}`);
  h.expect(r.copies === r.built, `a stopped awaken built new hit copies: ${detail}`);
  h.expect(!r.held.length, `a stopped awaken left hit copies or their gates running: ${detail}`);
  return r;
}

export async function customHitBringsItsRoar(h) {
  const r = await offline(h, async () => {
    const { AudioEngine } = await import('/src/audio/engine.ts');
    const c = new OfflineAudioContext(2, 2 * 48000, 48000);
    const e = new AudioEngine(c);
    e.music.to('awaken', 0.01, { at: 0.1 });
    const spares = window.__copies.map(({ roar }) => roar);
    const hit = e.play('awaken_hit', { at: 0.8, gain: 0.8 }).voice;
    await c.startRendering();
    const roar = window.__copies.find((copy) => copy.hit === hit)?.roar;
    return { roar: !!roar, opened: !!roar?.opened, shared: roar?.gate === hit.gate && roar?.openedAt === hit.openedAt,
      fresh: !spares.includes(roar), sparesLeft: spares.filter((v) => !v.isStopped).length };
  });
  const detail = JSON.stringify(r);
  h.expect(r.roar && r.opened && r.shared && r.fresh, `a hit with its own gain played without its roar: ${detail}`);
  h.expect(r.sparesLeft === 0, `the spare roars stayed after the hit played: ${detail}`);
  return r;
}

export async function failedBuildLetsGo(h) {
  const r = await offline(h, async () => {
    const { Voice } = await import('/src/audio/voice.ts');
    const { copiesAhead, open } = await import('/src/audio/prebuild.ts');
    const c = new OfflineAudioContext(2, 48000, 48000);
    const lib = { ctx: c, room: c.destination, hall: c.destination, live: false, track: () => null };
    const built = [];
    let message = '';
    try {
      copiesAhead({ make: (seed) => {
        const voice = new Voice(lib, 0, c.destination, { held: true }, seed());
        voice.osc('sine', 440, 0, 0.5, voice.dry);
        built.push(voice);
        if (built.length === 3) throw new Error('the third copy failed');
        return { voice };
      }, seed: () => 1, lib });
    } catch (err) {
      message = err.message;
    }
    let rider;
    let opening = '';
    try {
      open(undefined, { make: () => {
        const voice = new Voice(lib, 0, c.destination, { held: true });
        rider = voice.part(voice.wet);
        rider.osc('sine', 660, 0, 0.5, rider.dry);
        voice.ride(rider);
        return { voice, prepare() {
          throw new Error('the opening failed');
        } };
      }, seed: () => 1, lib });
    } catch (err) {
      opening = err.message;
    }
    return { message, built: built.length, kept: built.filter((v) => !v.isDropped).length, opening,
      riderKept: !rider?.isDropped };
  });
  const detail = JSON.stringify(r);
  h.expect(r.message === 'the third copy failed', `the failed build was not reported: ${detail}`);
  h.expect(r.built === 3 && r.kept === 0, `a failed build kept copies or the voice it made: ${detail}`);
  h.expect(r.opening === 'the opening failed' && !r.riderKept, `a failed opening kept its rider: ${detail}`);
  return r;
}
