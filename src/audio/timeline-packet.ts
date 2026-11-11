import type { TimelineEvent } from './timeline';

const KINDS = ['adopt', 'set', 'linear', 'exponential', 'target', 'cancel', 'stop', 'align'] as const;
const CHANNELS = 32;

type Reply = { id: number; start: number; receivedAt: number; applied?: boolean; error?: string };
type Packet = { source: AudioBufferSourceNode; mailbox: AudioWorkletNode; delay: DelayNode };

export class PacketQueue {
  private packets = new Set<Packet>();
  private closed = false;
  private flushTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private ctx: AudioContext,
    private node: AudioWorkletNode,
    private timeline: number,
    private reply: (reply: Reply) => void,
    private fail: (error: Error) => void,
  ) {}

  send(id: number, requested: number, events: TimelineEvent[]) {
    if (events.length > 5460) throw new Error('The cue moment is too large');
    const words = new Uint16Array(12 + events.length * 12);
    words.set([41825, 1, id & 65535, id >>> 16, events.length, events.length * 12]);
    const bits = new DataView(new ArrayBuffer(8));
    bits.setFloat64(0, requested, true);
    for (let i = 0; i < 4; i++) words[8 + i] = bits.getUint16(i * 2, true);
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const kind = KINDS.indexOf(event.kind as (typeof KINDS)[number]);
      if (kind < 0) throw new Error(`Unsupported cue event: ${event.kind}`);
      const fields = [
        kind + 1,
        event.channel,
        (event.time ?? 0) * this.ctx.sampleRate,
        event.value ?? 0,
        (event.tau ?? 0) * this.ctx.sampleRate,
        (event.stop ?? 0) * this.ctx.sampleRate,
      ];
      for (let j = 0; j < fields.length; j++) {
        bits.setFloat32(0, fields[j], true);
        words[12 + i * 12 + j * 2] = bits.getUint16(0, true);
        words[13 + i * 12 + j * 2] = bits.getUint16(2, true);
      }
    }
    let checksum = 2166136261;
    for (let i = 2; i < words.length; i++) {
      if (i !== 6 && i !== 7) checksum = Math.imul(checksum ^ words[i], 16777619) >>> 0;
    }
    words[6] = checksum & 65535;
    words[7] = checksum >>> 16;
    const buffer = this.ctx.createBuffer(
      CHANNELS,
      1 + Math.ceil(words.length / CHANNELS),
      this.ctx.sampleRate,
    );
    const channels = Array.from({ length: CHANNELS }, (_, i) => buffer.getChannelData(i));
    channels[0][0] = 1;
    for (let i = 0; i < words.length; i++)
      channels[i % CHANNELS][1 + Math.floor(i / CHANNELS)] = words[i] / 65536;
    const source = this.ctx.createBufferSource();
    const delay = this.ctx.createDelay(1);
    const mailbox = new AudioWorkletNode(this.ctx, 'cue-mailbox', {
      numberOfInputs: 1,
      numberOfOutputs: 2,
      outputChannelCount: [1, 1],
      channelCount: CHANNELS,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
      processorOptions: { timeline: this.timeline, id, words: words.length, events: events.length },
    });
    const packet = { source, mailbox, delay };
    this.packets.add(packet);
    let ended = false;
    let acknowledged = false;
    const cleanup = () => {
      if (!ended || !acknowledged) return;
      delay.disconnect();
      source.disconnect();
      mailbox.disconnect();
      mailbox.port.close();
      this.packets.delete(packet);
      if (!this.packets.size && this.flushTimer !== undefined) {
        clearInterval(this.flushTimer);
        this.flushTimer = undefined;
      }
    };
    mailbox.port.onmessage = ({ data }: MessageEvent<Reply>) => {
      acknowledged = true;
      this.reply(data);
      cleanup();
    };
    mailbox.onprocessorerror = () => this.fail(new Error('The cue mailbox stopped processing'));
    source.buffer = buffer;
    source.playbackRate.value = 0;
    delay.delayTime.value = 128 / this.ctx.sampleRate;
    mailbox.connect(delay, 0);
    delay.connect(source.playbackRate);
    mailbox.connect(this.node, 1, 0);
    source.connect(mailbox);
    source.onended = () => {
      ended = true;
      cleanup();
    };
    try {
      source.start();
      if (this.flushTimer === undefined) {
        this.flushTimer = setInterval(() => this.node.port.postMessage('flush'), 10);
      }
    } catch (error) {
      source.onended = null;
      source.disconnect();
      delay.disconnect();
      mailbox.disconnect();
      mailbox.port.close();
      this.packets.delete(packet);
      throw error;
    }
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    if (this.flushTimer !== undefined) clearInterval(this.flushTimer);
    for (const { source, mailbox, delay } of this.packets) {
      source.onended = null;
      try {
        source.stop();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'InvalidStateError')) throw error;
      }
      source.disconnect();
      delay.disconnect();
      mailbox.disconnect();
      mailbox.port.close();
    }
    this.packets.clear();
  }
}
