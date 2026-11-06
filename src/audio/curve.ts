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
    this.param.setValueAtTime(value, t);
    return this.record('set', value, t);
  }

  linearRampToValueAtTime(value: number, t: number) {
    const now = this.ctx.currentTime;
    const end = Math.max(t, now);
    let index = this.events.length - 1;
    while (index >= 0 && this.events[index].time > end) index--;
    const previous = this.events[index];
    this.param.linearRampToValueAtTime(value, t);
    if (!previous && end > now) this.setValueAtTime(this.initial, now);
    else if (previous?.kind === 'target') {
      const start = Math.max(now, previous.time);
      const from = start === previous.time
        ? this.evaluate(start, this.events.slice(0, index)) : this.valueAt(start);
      if (start < end) this.setValueAtTime(from, start);
    }
    return this.record('linear', value, t);
  }

  setTargetAtTime(value: number, t: number, tau: number) {
    this.param.setTargetAtTime(value, t, tau);
    const time = this.clampTime(t);
    const repeated = this.events.some((event) => event.kind === 'target' && event.time === time);
    if (!repeated) return this.record('target', value, t, tau);
    this.events = this.events.flatMap((event): Event[] => {
      if (event.kind !== 'target' || event.time !== time) return [event];
      return event.tau === 0 ? [{ ...event, kind: 'set' }] : [];
    });
    this.record('target', value, t, tau);
    this.param.cancelScheduledValues(time);
    for (const event of this.events) {
      if (event.time < time) continue;
      if (event.kind === 'set') this.param.setValueAtTime(event.value, event.time);
      else if (event.kind === 'linear') this.param.linearRampToValueAtTime(event.value, event.time);
      else this.param.setTargetAtTime(event.value, event.time, event.tau);
    }
    return this;
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
    if (!this.events.length || this.events[this.events.length - 1].time <= time) {
      this.events.push(event);
    } else {
      const index = this.events.findIndex((e) => e.time > time);
      this.events.splice(index, 0, event);
    }
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
