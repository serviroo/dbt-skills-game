import workletUrl from './timeline-worklet.js?url';
import { PacketQueue } from './timeline-packet';

export interface TimelineAck {
  start: number;
  receivedAt: number;
  applied?: boolean;
}

export type TimelineEvent = {
  channel: number;
  kind: 'adopt' | 'set' | 'linear' | 'exponential' | 'target' | 'cancel' | 'stop' | 'align';
  time?: number;
  value?: number;
  tau?: number;
  stop?: number;
};

class TimelineAutomation {
  readonly events: TimelineEvent[] = [];
  private adopted = new WeakSet<AudioParam>();

  constructor(private allocate: (param: AudioParam) => number) {}

  private channel(param: AudioParam) {
    const channel = this.allocate(param);
    if (!this.adopted.has(param)) {
      this.adopted.add(param);
      this.events.push({ channel, kind: 'adopt', value: param.value });
    }
    return channel;
  }

  at(param: AudioParam) {
    const ch = this.channel(param);
    return {
      setValueAtTime: (value: number, time: number) =>
        this.events.push({ channel: ch, kind: 'set', value, time }),
      linearRampToValueAtTime: (value: number, time: number) =>
        this.events.push({ channel: ch, kind: 'linear', value, time }),
      exponentialRampToValueAtTime: (value: number, time: number) =>
        this.events.push({ channel: ch, kind: 'exponential', value, time }),
      setTargetAtTime: (value: number, time: number, tau: number) =>
        this.events.push({ channel: ch, kind: 'target', value, time, tau }),
      cancelScheduledValues: (time: number) => this.events.push({ channel: ch, kind: 'cancel', time }),
    };
  }

  fromZero(param: AudioParam, time: number, initial: number) {
    const channel = this.channel(param);
    const at = this.events.findIndex((event) => event.channel === channel && event.kind === 'adopt');
    this.events[at].value = 0;
    this.events.splice(at + 1, 0, { channel, kind: 'set', value: initial, time });
    return channel;
  }
}

let nextTimelineId = 0;

export class TimelineNode {
  readonly node: AudioWorkletNode;
  private readonly packets: PacketQueue;
  private nextId = 0;
  private pending = new Map<
    number,
    { resolve: (ack: TimelineAck) => void; reject: (error: Error) => void }
  >();
  private failure: Error | null = null;
  private onState: () => void;

  constructor(
    private ctx: AudioContext,
    outputChannels: number[],
  ) {
    const timeline = nextTimelineId++;
    this.node = new AudioWorkletNode(ctx, 'cue-timeline', {
      numberOfInputs: 1,
      numberOfOutputs: outputChannels.length,
      outputChannelCount: outputChannels,
      channelCount: 32,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
      processorOptions: { timeline, channels: outputChannels.reduce((total, count) => total + count, 0) },
    });
    this.node.port.onmessage = ({ data }) => {
      if (data === 'disposed') this.node.port.close();
    };
    this.packets = new PacketQueue(
      ctx,
      this.node,
      timeline,
      (data) => {
        const pending = this.pending.get(data.id);
        if (!pending) return;
        this.pending.delete(data.id);
        if (data.error) pending.reject(new Error(data.error));
        else
          pending.resolve({
            start: data.start,
            receivedAt: data.receivedAt,
            ...(data.applied === false ? { applied: false } : {}),
          });
      },
      (error) => this.fail(error),
    );
    this.node.onprocessorerror = () => {
      const error = new Error('The cue timeline stopped processing');
      console.error('[audio]', error);
      this.fail(error);
    };
    this.onState = () => {
      if (this.ctx.state === 'closed') this.fail(new Error('The audio context closed'));
    };
    ctx.addEventListener('statechange', this.onState);
  }

  moment(requested: number, events: TimelineEvent[] = []): Promise<TimelineAck> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++ >>> 0;
    const ack = new Promise<TimelineAck>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    try {
      this.packets.send(id, requested, events);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
    return ack;
  }

  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  dispose() {
    this.fail(new Error('The cue timeline was disposed'));
    this.ctx.removeEventListener('statechange', this.onState);
    this.packets.dispose();
    this.node.port.postMessage('dispose');
    this.node.disconnect();
  }
}

export class TimelineHost {
  readonly ready: Promise<void>;
  private loaded = false;

  constructor(private ctx: AudioContext) {
    if (ctx.state === 'running' || ctx.state === 'suspended')
      void ctx.suspend().catch((error: unknown) => console.error('[audio] suspend failed', error));
    this.ready = ctx.audioWorklet.addModule(workletUrl).then(() => {
      this.loaded = true;
    });
    void this.ready.catch(() => {});
  }

  get isReady() {
    return this.loaded;
  }

  create(outputChannels: number[]) {
    return this.loaded
      ? new TimelineNode(this.ctx, outputChannels)
      : this.ready.then(() => new TimelineNode(this.ctx, outputChannels));
  }
}

export class CueTimeline {
  private readonly channels: (AudioParam | null)[] = [];
  private readonly byParam = new WeakMap<AudioParam, number>();
  readonly automation = new TimelineAutomation((param) => this.reserve(param));
  private readonly oscillators: OscillatorNode[] = [];
  private started = false;
  private node: Promise<TimelineNode> | null = null;
  private currentNode: TimelineNode | null = null;
  private splitters: ChannelSplitterNode[] = [];
  private disposed = false;

  constructor(
    private host: TimelineHost,
    private ctx: AudioContext,
    private out: AudioNode,
    stopParams: AudioParam[],
  ) {
    this.reserveStops(stopParams);
  }

  reserveStops(params: AudioParam[]) {
    for (const param of params) this.reserve(param);
  }

  private reserve(param: AudioParam) {
    let channel = this.byParam.get(param);
    if (channel === undefined) {
      channel = this.channels.length;
      this.channels.push(param);
      this.byParam.set(param, channel);
    }
    return channel;
  }

  osc(source: OscillatorNode, gate: GainNode, start: number, stop: number, frequency: number) {
    const channel = this.automation.fromZero(source.frequency, start, frequency);
    this.automation.events.push({ channel, kind: 'align', time: start });
    const level = this.automation.at(gate.gain);
    level.setValueAtTime(1, start);
    level.setValueAtTime(0, stop);
    this.oscillators.push(source);
  }

  private stopSources() {
    if (!this.started) return;
    this.started = false;
    for (const source of this.oscillators) {
      try {
        source.stop();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'InvalidStateError')) throw error;
      }
      source.disconnect();
    }
  }

  open(requested: number) {
    const events = this.automation.events.splice(0);
    let done!: (node: TimelineNode) => void;
    let fail!: (error: Error) => void;
    this.node = new Promise((resolve, reject) => {
      done = resolve;
      fail = reject;
    });
    void this.node.catch(() => {});
    const count = Math.max(1, this.channels.length);
    const outputs = Array.from({ length: Math.ceil(count / 32) }, (_, i) => Math.min(32, count - i * 32));
    const place = (created: TimelineNode) => {
      try {
        if (this.disposed) {
          throw new Error('The cue timeline was disposed');
        }
        this.splitters = outputs.map((channels, index) => {
          const splitter = this.ctx.createChannelSplitter(channels);
          created.node.connect(splitter, index);
          return splitter;
        });
        this.channels.forEach((param, channel) => {
          if (param) this.splitters[Math.floor(channel / 32)].connect(param, channel % 32);
        });
        if (!this.channels.length) created.node.connect(this.out);
        this.started = true;
        for (const source of this.oscillators) source.start();
        if (this.disposed) {
          throw new Error('The cue timeline was disposed');
        }
        const ack = created.moment(requested, events);
        this.currentNode = created;
        done(created);
        return ack;
      } catch (error) {
        this.stopSources();
        for (const splitter of this.splitters) splitter.disconnect();
        created.dispose();
        throw error;
      }
    };
    let opening: Promise<TimelineAck>;
    try {
      const created = this.host.create(outputs);
      opening = created instanceof Promise ? created.then(place) : place(created);
    } catch (error) {
      opening = Promise.reject(error);
    }
    void opening.catch(fail);
    return opening;
  }

  stop(requested: number, tau: number, duration: number, params: AudioParam[]) {
    for (const param of params) {
      const p = this.automation.at(param);
      p.cancelScheduledValues(0);
      p.setTargetAtTime(0, 0, tau);
    }
    const events: TimelineEvent[] = [
      { channel: this.byParam.get(params[0])!, kind: 'stop', stop: duration },
      ...this.automation.events.splice(0),
    ];
    return this.currentNode
      ? this.currentNode.moment(requested, events)
      : this.node!.then((node) => node.moment(requested, events));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    void this.node?.then(
      (node) => {
        this.stopSources();
        for (const splitter of this.splitters) splitter.disconnect();
        node.dispose();
      },
      () => {},
    );
  }
}
