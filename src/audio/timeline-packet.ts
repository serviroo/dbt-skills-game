import type { TimelineEvent } from './timeline';

const KINDS = ['adopt', 'set', 'linear', 'exponential', 'target', 'cancel', 'stop', 'align'] as const;
const CHANNELS = 32;
const INPUTS = 32;

export class PacketQueue {
  private slots = Array.from({ length: INPUTS }, () => ({ source: null as AudioBufferSourceNode | null, readyAt: 0 }));
  private queue: { id: number; buffer: AudioBuffer }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private onState = () => this.pump();
  private closed = false;
  private ready: DelayNode;

  constructor(private ctx: AudioContext, private node: AudioWorkletNode, output: number, private fail: (id: number, error: Error) => void) {
    this.ready = ctx.createDelay(1);
    this.ready.delayTime.value = 128 / ctx.sampleRate;
    node.connect(this.ready, output);
    ctx.addEventListener('statechange', this.onState);
  }

  send(id: number, requested: number, events: TimelineEvent[]) {
    if (events.length > 5460) throw new Error('The cue moment is too large');
    const words = new Uint16Array(12 + events.length * 12);
    words.set([41825, 1, id & 65535, id >>> 16, events.length, events.length * 12]);
    const bits = new DataView(new ArrayBuffer(8));
    bits.setFloat64(0, requested, true);
    for (let i = 0; i < 4; i++) words[8 + i] = bits.getUint16(i * 2, true);
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const kind = KINDS.indexOf(event.kind as typeof KINDS[number]);
      if (kind < 0) throw new Error(`Unsupported cue event: ${event.kind}`);
      const fields = [kind + 1, event.channel, (event.time ?? 0) * this.ctx.sampleRate, event.value ?? 0, (event.tau ?? 0) * this.ctx.sampleRate, (event.stop ?? 0) * this.ctx.sampleRate];
      for (let j = 0; j < fields.length; j++) {
        bits.setFloat32(0, fields[j], true);
        words[12 + i * 12 + j * 2] = bits.getUint16(0, true);
        words[13 + i * 12 + j * 2] = bits.getUint16(2, true);
      }
    }
    let checksum = 2166136261;
    for (let i = 2; i < words.length; i++) if (i !== 6 && i !== 7) checksum = Math.imul(checksum ^ words[i], 16777619) >>> 0;
    words[6] = checksum & 65535;
    words[7] = checksum >>> 16;
    const buffer = this.ctx.createBuffer(CHANNELS, 1 + Math.ceil(words.length / CHANNELS), this.ctx.sampleRate);
    const channels = Array.from({ length: CHANNELS }, (_, i) => buffer.getChannelData(i));
    for (let i = 0; i < words.length; i++) channels[i % CHANNELS][1 + Math.floor(i / CHANNELS)] = words[i] / 65536;
    this.queue.push({ id, buffer });
    this.pump();
  }

  private pump() {
    if (this.closed || this.ctx.state === 'closed') return;
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; }
    const now = this.ctx.currentTime;
    for (let i = 0; i < this.slots.length && this.queue.length; i++) {
      const slot = this.slots[i];
      if (slot.source || slot.readyAt > now) continue;
      const task = this.queue.shift()!;
      const source = this.ctx.createBufferSource();
      slot.source = source;
      source.buffer = task.buffer;
      source.playbackRate.value = 0;
      this.ready.connect(source.playbackRate);
      source.connect(this.node, 0, i);
      source.onended = () => {
        this.ready.disconnect(source.playbackRate);
        source.disconnect();
        slot.source = null;
        slot.readyAt = this.ctx.currentTime + 128 / this.ctx.sampleRate;
        this.pump();
      };
      try { source.start(); } catch (error) {
        this.ready.disconnect(source.playbackRate);
        source.disconnect();
        slot.source = null;
        this.fail(task.id, error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (this.ctx.state === 'running' && this.queue.length && this.slots.some((slot) => !slot.source)) {
      const wait = Math.min(...this.slots.filter((slot) => !slot.source).map((slot) => slot.readyAt - now));
      this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, Math.max(1, Math.ceil(wait * 1000)));
    }
  }

  dispose() {
    this.closed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.ctx.removeEventListener('statechange', this.onState);
    this.ready.disconnect();
    for (const slot of this.slots) if (slot.source) {
      slot.source.onended = null;
      try { slot.source.stop(); } catch (error) { if (!(error instanceof DOMException && error.name === 'InvalidStateError')) throw error; }
      slot.source.disconnect();
      slot.source = null;
    }
    this.queue.length = 0;
  }
}
