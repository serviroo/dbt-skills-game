const timelines = new Map();
const KIND = 0;
const TIME = 1;
const FRAME = 2;
const VALUE = 3;
const TAU = 4;
const STRIDE = 5;

function frameAt(samples) {
  return Math.ceil(samples - Math.max(1, Math.abs(samples)) * Number.EPSILON * 2);
}

function read(event, field) {
  return event.values[event.index + field];
}

function write(event, field, value) {
  event.values[event.index + field] = value;
}

function timelineFor(id) {
  let timeline = timelines.get(id);
  if (!timeline) {
    timeline = { slots: [], next: 0, params: [], stops: null };
    timelines.set(id, timeline);
  }
  return timeline;
}

class CueTimelineProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { timeline, channels } = options.processorOptions;
    this.missingAdoption = new Error('Automation used before adoption');
    this.timeline = timelineFor(timeline);
    this.timeline.params = Array.from({ length: channels }, () => ({
      adopted: false,
      base: 0,
      first: null,
      value: 0,
      mode: 0,
      step: 0,
      target: 0,
      next: Infinity,
    }));
    this.timeline.stops = new Float64Array(channels);
    this.timeline.stops.fill(Infinity);
    this.port.onmessage = ({ data }) => {
      if (data === 'flush') {
        const slots = this.timeline.slots;
        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i];
          if (!slot || !slot.applied) continue;
          slot.port.postMessage(slot.ack);
          slots[i] = null;
        }
      } else if (data === 'dispose') {
        timelines.delete(timeline);
        this.port.postMessage('disposed');
      }
    };
  }

  insert(p, slot, kind, time, value, tau) {
    let previous = null;
    let next = p.first;
    while (next && read(next, TIME) < time) {
      previous = next;
      next = next.next;
    }
    let same = next;
    while (same && read(same, TIME) === time) {
      if (read(same, KIND) === kind) {
        write(same, VALUE, value);
        write(same, TAU, tau);
        write(same, FRAME, frameAt(time * sampleRate));
        return;
      }
      previous = same;
      same = same.next;
    }
    const event = slot.take();
    write(event, KIND, kind);
    write(event, TIME, time);
    write(event, FRAME, frameAt(time * sampleRate));
    write(event, VALUE, value);
    write(event, TAU, tau);
    event.next = same;
    if (previous) previous.next = event;
    else p.first = event;
  }

  schedule(slot, kind, channel, time, value, tau, start) {
    const p = this.timeline.params[channel];
    if (kind === 1) {
      if (!p.adopted) {
        p.adopted = true;
        p.base = value;
        p.value = value;
      }
      return;
    }
    if (!p || !p.adopted) throw this.missingAdoption;
    time += start;
    if (kind === 8) {
      const frame = frameAt(time * sampleRate);
      for (let e = p.first; e; e = e.next)
        if (read(e, TIME) >= time - 1e-9) {
          const relative = read(e, TIME) - time;
          write(e, TIME, frame / sampleRate + relative);
          write(e, FRAME, frameAt(frame + relative * sampleRate));
        }
      return;
    }
    if (kind === 6) {
      let previous = null;
      let event = p.first;
      while (event && read(event, TIME) < time) {
        previous = event;
        event = event.next;
      }
      if (previous) previous.next = null;
      else p.first = null;
      return;
    }
    if (kind === 3 || kind === 4) {
      const now = currentFrame / sampleRate;
      let previous = null;
      for (let e = p.first; e && read(e, TIME) <= time; e = e.next) previous = e;
      if (now < time && (!previous || (read(previous, KIND) === 4 && read(previous, TIME) < now))) {
        this.segment(p, currentFrame);
        this.insert(p, slot, 1, now, p.value, 0);
      }
    }
    this.insert(p, slot, kind - 1, time, value, tau);
  }

  segment(p, frame) {
    const time = frame / sampleRate;
    let value = p.base;
    let previous = null;
    let target = 0;
    let tau = 0;
    let from = 0;
    let event = p.first;
    while (event && read(event, FRAME) <= frame) {
      if (tau > 0) value = target + (value - target) * Math.exp(-(read(event, TIME) - from) / tau);
      if (read(event, KIND) === 4) {
        target = read(event, VALUE);
        tau = read(event, TAU);
        if (!tau) value = target;
      } else {
        value = read(event, VALUE);
        tau = 0;
      }
      from = read(event, TIME);
      previous = event;
      event = event.next;
    }
    p.mode = 0;
    p.next = event ? read(event, FRAME) : Infinity;
    if (event && (read(event, KIND) === 2 || read(event, KIND) === 3) && previous && read(event, TIME) > from) {
      const fraction = Math.max(0, (time - from) / (read(event, TIME) - from));
      const end = read(event, VALUE);
      if (read(event, KIND) === 2) {
        const origin = value;
        value += (end - value) * fraction;
        p.step = (end - origin) / ((read(event, TIME) - from) * sampleRate);
        p.mode = 1;
      } else if (value !== 0 && end / value > 0) {
        const ratio = end / value;
        value *= Math.exp(Math.log(ratio) * fraction);
        p.step = Math.exp(Math.log(ratio) / ((read(event, TIME) - from) * sampleRate));
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

  apply(slot) {
    const words = slot.words;
    const bits = slot.bits;
    for (let i = 0; i < 4; i++) bits.setUint16(i * 2, words[8 + i], true);
    const requested = bits.getFloat64(0, true);
    const start = Math.max(requested, currentFrame / sampleRate);
    let applied = true;
    if (!slot.error && words[4]) {
      const kind = slot.number(0);
      const channel = slot.number(1);
      const stop = start + slot.number(5) / sampleRate;
      if (kind === 7) {
        applied = stop < this.timeline.stops[channel];
        if (applied) this.timeline.stops[channel] = stop;
      }
      if (applied)
        for (let i = 0; i < words[4]; i++) {
          const at = i * 6;
          const event = slot.number(at);
          if (event !== 7)
            this.schedule(
              slot,
              event,
              slot.number(at + 1),
              slot.number(at + 2) / sampleRate,
              slot.number(at + 3),
              slot.number(at + 4) / sampleRate,
              start,
            );
        }
    }
    slot.ack.start = start;
    slot.ack.receivedAt = slot.receivedAt;
    slot.ack.applied = applied;
    slot.ack.error = slot.error;
    slot.applied = true;
  }

  process(inputs, outputs) {
    const state = this.timeline;
    for (;;) {
      let selected = -1;
      for (let i = 0; i < state.slots.length; i++) {
        const slot = state.slots[i];
        if (slot && slot.id === state.next && slot.complete) {
          selected = i;
          break;
        }
      }
      if (selected < 0) break;
      const slot = state.slots[selected];
      this.apply(slot);
      state.next = (state.next + 1) >>> 0;
    }
    for (let channel = 0; channel < state.params.length; channel++) {
      const p = state.params[channel];
      if (!p.adopted) continue;
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

class CueMailboxProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { timeline, id, words, events } = options.processorOptions;
    this.exhausted = new Error('Cue automation exceeded its packet');
    this.id = id;
    this.words = new Uint16Array(words);
    this.bits = new DataView(new ArrayBuffer(8));
    const capacity = events * 2 + 1;
    const values = new Float64Array(capacity * STRIDE);
    this.records = Array.from({ length: capacity }, (_, index) => ({ values, index: index * STRIDE, next: null }));
    this.used = 0;
    this.ready = false;
    this.count = 0;
    this.expected = 0;
    this.complete = false;
    this.applied = false;
    this.receivedAt = 0;
    this.error = '';
    this.ack = { id, start: 0, receivedAt: 0, applied: true, error: '' };
    const state = timelineFor(timeline);
    const free = state.slots.indexOf(null);
    if (free < 0) state.slots.push(this);
    else state.slots[free] = this;
  }

  take() {
    const record = this.records[this.used++];
    if (!record) throw this.exhausted;
    return record;
  }

  number(index) {
    const field = index % 6;
    const position = field < 2 ? field * 2 : field === 2 || field === 5 ? 4 : field * 2 + 2;
    const offset = 12 + Math.floor(index / 6) * 12 + position;
    this.bits.setUint16(0, this.words[offset], true);
    this.bits.setUint16(2, this.words[offset + 1], true);
    if (field === 2 || field === 5) {
      this.bits.setUint16(4, this.words[offset + 2], true);
      this.bits.setUint16(6, this.words[offset + 3], true);
      return this.bits.getFloat64(0, true);
    }
    return this.bits.getFloat32(0, true);
  }

  process(inputs, outputs) {
    const channels = inputs[0];
    if (!this.ready && channels.length) {
      const marker = channels[0];
      for (let i = 0; i < marker.length; i++)
        if (marker[i] === 1) {
          this.ready = true;
          break;
        }
    }
    outputs[0][0].fill(this.ready ? 1 : 0);
    if (this.complete || !channels.length) return !this.complete;
    for (let frame = 0; frame < channels[0].length; frame++) {
      for (let channel = 0; channel < channels.length; channel++) {
        const word = Math.round(channels[channel][frame] * 65536);
        if (!this.count && word !== 41825) continue;
        this.words[this.count++] = word;
        if (this.count === 12) {
          this.expected = 12 + this.words[5];
          if (
            this.words[1] !== 1 ||
            this.words[5] !== this.words[4] * 12 ||
            this.expected !== this.words.length
          ) {
            this.error = 'Invalid cue packet header';
            this.complete = true;
          }
        }
        if (!this.complete && this.expected && this.count === this.expected) {
          let checksum = 2166136261;
          for (let i = 2; i < this.count; i++) {
            if (i !== 6 && i !== 7) checksum = Math.imul(checksum ^ this.words[i], 16777619) >>> 0;
          }
          const expected = (this.words[6] | (this.words[7] << 16)) >>> 0;
          if (checksum !== expected) this.error = 'The cue packet failed its integrity check';
          this.complete = true;
        }
        if (this.complete) {
          this.receivedAt = currentFrame / sampleRate;
          return false;
        }
      }
    }
    return true;
  }
}

registerProcessor('cue-timeline', CueTimelineProcessor);
registerProcessor('cue-mailbox', CueMailboxProcessor);
