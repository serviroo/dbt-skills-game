export function oldHold(p, t) {
  const value = p.valueAt(t);
  const linear = p.rampValueAt(t);
  p.cancelScheduledValues(t);
  return { value, linear };
}

export class OldCurve {
  cancelScheduledValues(t) {
    this.param.cancelScheduledValues(t);
    this.events = this.events.filter((event) => event.time < t);
  }
}

export function hold(p, t) {
  const time = p.clampTime(t);
  const alias = time;
  const value = p.valueAt(alias);
  p.rampValueAt(alias);
  p.cancelScheduledValues(alias);
  return value;
}

export class Curve {
  cancelScheduledValues(t) {
    const time = this.clampTime(t);
    this.param.cancelScheduledValues(time);
  }
}
