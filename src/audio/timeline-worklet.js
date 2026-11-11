const eventKinds = ['', 'adopt', 'set', 'linear', 'exponential', 'target', 'cancel', 'stop', 'align'];

class CueTimelineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inputs = Array.from({ length: 32 }, () => new PacketDecoder());
    this.params = [];
    this.stops = new Map();
  }

  schedule(event, start) {
    let p = this.params[event.channel];
    if (event.kind === 'adopt') {
      if (!p) {
        p = { channel: event.channel, base: event.value, count: 0, times: new Float64Array(16), frames: new Float64Array(16), values: new Float64Array(16), taus: new Float64Array(16), kinds: new Uint8Array(16), value: event.value, mode: 0, step: 0, target: 0, next: Infinity };
        this.params[event.channel] = p;
      }
      return;
    }
    if (!p) throw new Error('Automation used before adoption');
    const time = start + event.time;
    if (event.kind === 'align') {
      const frame = Math.ceil(time * sampleRate);
      for (let i = 0; i < p.count; i++) if (p.times[i] >= time - 1e-9) {
        const relative = p.times[i] - time;
        p.times[i] = frame / sampleRate + relative;
        p.frames[i] = Math.ceil(frame + relative * sampleRate);
      }
      return;
    }
    if (event.kind === 'cancel') {
      let n = 0;
      while (n < p.count && p.times[n] < time) n++;
      p.count = n;
      return;
    }
    if (event.kind === 'linear' || event.kind === 'exponential') {
      const now = currentFrame / sampleRate;
      let previous = p.count - 1;
      while (previous >= 0 && p.times[previous] > time) previous--;
      if (now < time && (previous < 0 || (p.kinds[previous] === 4 && p.times[previous] < now))) {
        this.segment(p, currentFrame);
        this.schedule({ channel: event.channel, kind: 'set', value: p.value, time: now - start }, start);
      }
    }
    if (p.count === p.times.length) {
      const grow = (old) => {
        const next = new old.constructor(old.length * 2);
        next.set(old);
        return next;
      };
      p.times = grow(p.times);
      p.frames = grow(p.frames);
      p.values = grow(p.values);
      p.taus = grow(p.taus);
      p.kinds = grow(p.kinds);
    }
    const kind = { set: 1, linear: 2, exponential: 3, target: 4 }[event.kind];
    let at = p.count;
    while (at > 0 && p.times[at - 1] > time) at--;
    let replace = -1;
    for (let i = at; i < p.count && p.times[i] === time; i++) if (p.kinds[i] === kind) replace = i;
    if (replace >= 0) at = replace;
    else {
      while (at < p.count && p.times[at] === time) at++;
      for (let i = p.count; i > at; i--) {
        p.times[i] = p.times[i - 1];
        p.frames[i] = p.frames[i - 1];
        p.values[i] = p.values[i - 1];
        p.taus[i] = p.taus[i - 1];
        p.kinds[i] = p.kinds[i - 1];
      }
      p.count++;
    }
    p.times[at] = time;
    p.frames[at] = Math.ceil(time * sampleRate);
    p.values[at] = event.value;
    p.taus[at] = event.tau || 0;
    p.kinds[at] = kind;
  }

  segment(p, frame) {
    const time = frame / sampleRate;
    let value = p.base;
    let previous = -1;
    let target = 0;
    let tau = 0;
    let from = 0;
    let i = 0;
    while (i < p.count && p.frames[i] <= frame) {
      if (tau > 0) value = target + (value - target) * Math.exp(-(p.times[i] - from) / tau);
      if (p.kinds[i] === 4) {
        target = p.values[i];
        tau = p.taus[i];
        if (!tau) value = target;
      } else {
        value = p.values[i];
        tau = 0;
      }
      from = p.times[i];
      previous = i++;
    }
    p.mode = 0;
    p.next = i < p.count ? p.frames[i] : Infinity;
    if (i < p.count && (p.kinds[i] === 2 || p.kinds[i] === 3) && previous >= 0 && p.times[i] > from) {
      const fraction = Math.max(0, (time - from) / (p.times[i] - from));
      const end = p.values[i];
      if (p.kinds[i] === 2) {
        const origin = value;
        value += (end - value) * fraction;
        p.step = (end - origin) / ((p.times[i] - from) * sampleRate);
        p.mode = 1;
      } else if (value !== 0 && end / value > 0) {
        const ratio = end / value;
        value *= Math.exp(Math.log(ratio) * fraction);
        p.step = Math.exp(Math.log(ratio) / ((p.times[i] - from) * sampleRate));
        p.mode = 2;
      }
    } else if (tau > 0) {
      value = target + (value - target) * Math.exp(-(time - from) / tau);
      p.target = target;
      p.step = Math.exp(-1 / (tau * sampleRate));
      p.mode = 3;
    }
    p.value = value;
  }

  process(inputs, outputs) {
    outputs[outputs.length - 1][0].fill(1);
    for (let i = 0; i < inputs.length; i++) if (inputs[i].length) this.inputs[i].receive(inputs[i], this);
    for (let channel = 0; channel < this.params.length; channel++) {
      const p = this.params[channel];
      if (!p) continue;
      const output = outputs[Math.floor(channel / 32)]?.[channel % 32];
      if (!output) continue;
      this.segment(p, currentFrame);
      for (let i = 0; i < output.length; i++) {
        if (currentFrame + i >= p.next) this.segment(p, currentFrame + i);
        output[i] = p.value - p.base;
        if (p.mode === 1) p.value += p.step;
        else if (p.mode === 2) p.value *= p.step;
        else if (p.mode === 3) p.value = p.target + (p.value - p.target) * p.step;
      }
    }
    return true;
  }
}

registerProcessor('cue-timeline', CueTimelineProcessor);

class PacketDecoder {
  constructor() {
    this.words = new Uint16Array(12);
    this.values = new Float32Array(0);
    this.bits = new DataView(new ArrayBuffer(8));
    this.event = { kind: '', channel: 0, time: 0, value: 0, tau: 0, stop: 0 };
    this.count = 0;
    this.expected = 0;
  }

  receive(channels, target) {
    for (let frame = 0; frame < channels[0].length; frame++) {
      for (let channel = 0; channel < channels.length; channel++) {
        const word = Math.round(channels[channel][frame] * 65536);
        if (!this.count && word !== 41825) continue;
        this.words[this.count++] = word;
        if (this.count === 12) {
          this.expected = 12 + this.words[5];
          if (this.words[1] !== 1 || this.words[5] !== this.words[4] * 12 || this.expected > 65532) {
            target.port.postMessage({ id: (this.words[2] | (this.words[3] << 16)) >>> 0, error: 'Invalid cue packet header' });
            this.count = 0;
            this.expected = 0;
            continue;
          }
          if (this.expected > this.words.length) {
            const grown = new Uint16Array(this.expected);
            grown.set(this.words);
            this.words = grown;
            this.values = new Float32Array((this.expected - 12) / 2);
          }
        }
        if (!this.expected || this.count !== this.expected) continue;
        let checksum = 2166136261;
        for (let i = 2; i < this.count; i++) if (i !== 6 && i !== 7) checksum = Math.imul(checksum ^ this.words[i], 16777619) >>> 0;
        const expected = (this.words[6] | (this.words[7] << 16)) >>> 0;
        const id = (this.words[2] | (this.words[3] << 16)) >>> 0;
        if (checksum !== expected) {
          target.port.postMessage({ id, error: 'The cue packet failed its integrity check' });
          this.count = 0;
          this.expected = 0;
          continue;
        }
        for (let i = 0; i < 4; i++) this.bits.setUint16(i * 2, this.words[8 + i], true);
        const requested = this.bits.getFloat64(0, true);
        const length = this.words[5] / 2;
        for (let i = 0; i < length; i++) {
          this.bits.setUint16(0, this.words[12 + i * 2], true);
          this.bits.setUint16(2, this.words[13 + i * 2], true);
          this.values[i] = this.bits.getFloat32(0, true);
        }
        const receivedAt = currentFrame / sampleRate;
        const start = Math.max(requested, receivedAt);
        const stop = this.values[0] === 7;
        const stopAt = start + this.values[5] / sampleRate;
        const applied = !stop || stopAt < (target.stops.get(this.values[1]) ?? Infinity);
        if (stop && applied) target.stops.set(this.values[1], stopAt);
        if (applied) for (let i = 0; i < length; i += 6) {
          const event = this.event;
          event.kind = eventKinds[this.values[i]];
          event.channel = this.values[i + 1];
          event.time = this.values[i + 2] / sampleRate;
          event.value = this.values[i + 3];
          event.tau = this.values[i + 4] / sampleRate;
          event.stop = this.values[i + 5] / sampleRate;
          if (event.kind !== 'stop') target.schedule(event, start);
        }
        target.port.postMessage({ id, start, receivedAt, applied });
        this.count = 0;
        this.expected = 0;
      }
    }
  }
}
