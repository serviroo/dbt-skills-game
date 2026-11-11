type Interval = { node: ConstantSourceNode; start: number; end: number };

export class EndpointGate {
  readonly gain: GainNode;
  private intervals = new Set<Interval>();

  constructor(private ctx: BaseAudioContext, at = 0) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.open(at);
  }

  private stop(interval: Interval, at: number) {
    interval.node.stop(at);
    interval.end = at;
  }

  open(at: number) {
    for (const interval of this.intervals) {
      if (interval.end > at) this.stop(interval, at);
    }
    const node = this.ctx.createConstantSource();
    const interval = { node, start: at, end: Infinity };
    this.intervals.add(interval);
    node.offset.value = 1;
    node.connect(this.gain.gain);
    node.onended = () => {
      node.disconnect();
      this.intervals.delete(interval);
    };
    node.start(at);
  }

  close(at: number, end: number) {
    for (const interval of this.intervals) {
      if (interval.start > at) {
        const cutoff = Math.min(end, interval.start);
        if (interval.end > cutoff) this.stop(interval, cutoff);
      } else if (interval.end > Math.max(at, this.ctx.currentTime)) {
        this.stop(interval, end);
      } else if (interval.end > end) {
        this.stop(interval, end);
      }
    }
  }
}
