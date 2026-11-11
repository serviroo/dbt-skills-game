type Event = {
  kind: 'set' | 'linear' | 'target';
  value: number;
  time: number;
  tau: number;
  calledAt: number;
};

export class Curve {
  private events: Event[] = [];
  private initial: number;

  constructor(private param: AudioParam, private ctx: BaseAudioContext, initial: number) {
    this.param.value = initial;
    this.initial = Math.fround(initial);
  }

  valueAt(t: number) {
    return this.evaluate(t, this.events);
  }

  scheduledFrom(t: number) {
    const time = this.clampTime(t);
    const active = this.events.filter((event) => event.time <= time).at(-1);
    const future = this.events.filter((event) => event.time > time).map((event) => ({ ...event }));
    return active?.kind === 'target' ? [{ ...active, time }, ...future] : future;
  }

  clampTime(t: number) {
    return Math.max(t, this.ctx.currentTime);
  }

  private rampStart(event: Event, previous?: Event) {
    return previous?.kind === 'target'
      ? Math.max(previous.time, event.calledAt) : previous?.time ?? event.calledAt;
  }

  private compact() {
    const now = this.ctx.currentTime;
    let latest = this.events.length - 1;
    while (latest >= 0 && this.events[latest].time >= now) latest--;
    if (latest <= 0) return;
    const event = this.events[latest];
    this.initial = event.kind === 'target'
      ? this.evaluate(event.time, this.events.slice(0, latest)) : event.value;
    this.events.splice(0, latest);
  }

  private evaluate(t: number, events: Event[]) {
    let value = this.initial;
    let previous: Event | undefined;
    const targetAt = (time: number) => {
      if (previous?.kind !== 'target') return value;
      if (previous.tau === 0) return previous.value;
      return previous.value + (value - previous.value) * Math.exp(-(time - previous.time) / previous.tau);
    };
    for (const event of events) {
      if (event.kind === 'linear' && t < event.time) {
        const start = this.rampStart(event, previous);
        if (t < start) return targetAt(t);
        const from = previous?.kind === 'target' && start === previous.time ? value : targetAt(start);
        return from + (event.value - from) * (t - start) / (event.time - start);
      }
      if (t < event.time) break;
      value = event.kind === 'target' ? targetAt(event.time) : event.value;
      previous = event;
    }
    return targetAt(t);
  }

  rampValueAt(t: number) {
    let previous: Event | undefined;
    for (const [index, event] of this.events.entries()) {
      if (event.time >= t) {
        const start = this.rampStart(event, previous);
        if (event.kind === 'linear' && start < t) return this.evaluate(t, this.events.slice(0, index + 1));
        return undefined;
      }
      previous = event;
    }
    return undefined;
  }

  setValueAtTime(value: number, t: number) {
    this.checkEvent('set', t);
    this.param.setValueAtTime(value, t);
    return this.record('set', value, t);
  }

  linearRampToValueAtTime(value: number, t: number) {
    this.checkEvent('linear', t);
    const now = this.ctx.currentTime;
    const end = this.clampTime(t);
    const previous = this.events[this.events.length - 1];
    if (!previous && end > now) this.setValueAtTime(this.initial, now);
    else if (previous?.kind === 'target') {
      const start = Math.max(now, previous.time);
      const from = start === previous.time
        ? this.evaluate(start, this.events.slice(0, -1)) : this.valueAt(start);
      if (start < end) {
        this.param.setValueAtTime(from, start);
        this.record('set', from, start);
      }
    }
    this.param.linearRampToValueAtTime(value, t);
    return this.record('linear', value, t);
  }

  setTargetAtTime(value: number, t: number, tau: number) {
    this.checkEvent('target', t);
    this.param.setTargetAtTime(value, t, tau);
    return this.record('target', value, t, tau);
  }

  private checkEvent(kind: Event['kind'], t: number) {
    const time = this.clampTime(t);
    const previous = this.events[this.events.length - 1];
    if (!previous) return;
    if (time < previous.time) {
      throw new Error('Tracked automation must be scheduled in time order; cancel or hold the future first.');
    }
    if (time !== previous.time) return;
    const sameTime = this.events.slice(-3).filter((event) => event.time === time);
    const followsAnchor = sameTime.length === 1 && previous.kind !== 'target'
      && (kind !== 'set' || previous.kind === 'linear');
    const followsHeldStep = sameTime.length === 2 && sameTime[0].kind === 'linear'
      && previous.kind === 'set' && kind !== 'set';
    if (!followsAnchor && !followsHeldStep) {
      throw new Error('Unsupported same-time tracked automation; cancel or hold before scheduling another change.');
    }
  }

  retarget(param: AudioParam, at: number) {
    if (tracked.has(param)) throw new Error('The parameter already has a tracked curve');
    const time = this.clampTime(at);
    const value = this.valueAt(time);
    const events = this.scheduledFrom(time);
    param.setValueAtTime(value, time);
    for (const event of events) {
      if (event.kind === 'linear') param.linearRampToValueAtTime(event.value, event.time);
      else if (event.kind === 'target') param.setTargetAtTime(event.value, event.time, event.tau);
      else param.setValueAtTime(event.value, event.time);
    }
    this.param = param;
    tracked.add(param);
  }

  cancelScheduledValues(t: number) {
    const time = this.clampTime(t);
    this.param.cancelScheduledValues(time);
    this.events = this.events.filter((event) => event.time < time);
    this.compact();
    return this;
  }

  exponentialRampToValueAtTime(): never {
    throw new Error('Exponential ramps cannot be tracked');
  }

  setValueCurveAtTime(): never {
    throw new Error('Value curves cannot be tracked');
  }

  private record(kind: Event['kind'], value: number, t: number, tau = 0) {
    const time = this.clampTime(t);
    const event = { kind, value: Math.fround(value), time, tau, calledAt: this.ctx.currentTime };
    this.events.push(event);
    this.compact();
    return this;
  }
}

const tracked = new WeakSet<AudioParam>();

export function trackParam(param: AudioParam, ctx: BaseAudioContext, initial: number) {
  if (initial === undefined) throw new Error('Tracking requires an explicit initial value');
  if (tracked.has(param)) throw new Error('The parameter already has a tracked curve');
  const curve = new Curve(param, ctx, initial);
  tracked.add(param);
  return curve;
}

export type TrackedGain = GainNode & { curve: Curve };

export function trackedGain(ctx: BaseAudioContext, initial: number): TrackedGain {
  const gain = ctx.createGain();
  return Object.assign(gain, { curve: trackParam(gain.gain, ctx, initial) });
}

export type StoppedGain = TrackedGain & {
  stopAt(time: number, at: number): void;
  resumeAt(time: number): void;
  level(): number;
};

export function stoppedGain(ctx: BaseAudioContext, initial: number, at = 0): StoppedGain {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const sources = new Set<{ node: ConstantSourceNode; start: number; end: number }>();
  const connect = (node: ConstantSourceNode, start: number) => {
    const entry = { node, start, end: Infinity };
    sources.add(entry);
    node.connect(gain.gain);
    node.onended = () => {
      node.disconnect();
      sources.delete(entry);
    };
    node.start(start);
    return entry;
  };
  const first = ctx.createConstantSource();
  const curve = trackParam(first.offset, ctx, initial);
  let source = connect(first, at);
  return Object.assign(gain, {
    curve,
    stopAt(time: number, at: number) {
      for (const entry of sources) {
        const end = entry.start > at ? at : time;
        const active = entry === source && entry.start <= at && entry.end > Math.max(at, ctx.currentTime);
        if (entry.end <= end && !active) continue;
        entry.node.stop(end);
        entry.end = end;
      }
    },
    resumeAt(time: number) {
      if (source.end === Infinity) return;
      const next = ctx.createConstantSource();
      curve.retarget(next.offset, time);
      if (time < source.end) {
        source.node.stop(time);
        source.end = time;
      }
      source = connect(next, time);
    },
    level() {
      const now = ctx.currentTime;
      let value = 0;
      for (const { node, start, end } of sources) if (start <= now && now < end) value += node.offset.value;
      return value;
    },
  });
}
