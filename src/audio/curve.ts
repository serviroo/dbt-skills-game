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

  constructor(private param: AudioParam, private ctx: BaseAudioContext) {
    this.initial = param.value;
  }

  set value(value: number) {
    if (this.events.length) throw new Error('Set a scheduled value while automation exists');
    this.param.value = value;
    this.initial = Math.fround(value);
  }

  valueAt(t: number) {
    return this.evaluate(t, this.events);
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
        const start = previous?.kind === 'target'
          ? Math.max(previous.time, event.calledAt)
          : previous?.time ?? event.calledAt;
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

  rampsThrough(t: number) {
    let previous: Event | undefined;
    for (const event of this.events) {
      if (event.time >= t) {
        const start = previous?.kind === 'target'
          ? Math.max(previous.time, event.calledAt)
          : previous?.time ?? event.calledAt;
        return event.kind === 'linear' && start < t;
      }
      previous = event;
    }
    return false;
  }

  setValueAtTime(value: number, t: number) {
    this.param.setValueAtTime(value, t);
    return this.record('set', value, t);
  }

  linearRampToValueAtTime(value: number, t: number) {
    const now = this.ctx.currentTime;
    const end = Math.max(t, now);
    let index = this.events.length - 1;
    while (index >= 0 && (this.events[index].time > end
      || (this.events[index].time === end && this.events[index].kind === 'linear'))) index--;
    const previous = this.events[index];
    this.param.linearRampToValueAtTime(value, t);
    if (!previous) this.setValueAtTime(this.initial, now);
    else if (previous.kind === 'target') {
      const start = Math.max(now, previous.time);
      const from = start === previous.time
        ? this.evaluate(start, this.events.slice(0, index)) : this.valueAt(start);
      this.setValueAtTime(from, start);
    }
    return this.record('linear', value, t);
  }

  setTargetAtTime(value: number, t: number, tau: number) {
    this.param.setTargetAtTime(value, t, tau);
    return this.record('target', value, t, tau);
  }

  cancelScheduledValues(t: number) {
    this.param.cancelScheduledValues(t);
    this.events = this.events.filter((event) => event.time < t);
    return this;
  }

  exponentialRampToValueAtTime(): never {
    throw new Error('Exponential ramps cannot be tracked');
  }

  setValueCurveAtTime(): never {
    throw new Error('Value curves cannot be tracked');
  }

  private record(kind: Event['kind'], value: number, t: number, tau = 0) {
    const time = Math.max(t, this.ctx.currentTime);
    const event = { kind, value: Math.fround(value), time, tau, calledAt: this.ctx.currentTime };
    if (!this.events.length || this.events[this.events.length - 1].time < time) {
      this.events.push(event);
      return this;
    }
    const index = this.events.findIndex((e) => e.time > time || (e.time === time && e.kind === kind));
    if (index === -1) this.events.push(event);
    else if (this.events[index].time === time && this.events[index].kind === kind) this.events[index] = event;
    else this.events.splice(index, 0, event);
    return this;
  }
}

const curves = new WeakMap<AudioParam, Curve>();

export function trackParam(param: AudioParam, ctx: BaseAudioContext) {
  let curve = curves.get(param);
  if (!curve) {
    curve = new Curve(param, ctx);
    curves.set(param, curve);
  }
  return curve;
}
