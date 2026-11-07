class BusLevels {
  hold(p: Curve, at: number, until: number) {
    return p.scheduledFrom(at).map((event) => ({
      ...event,
      time: event.kind === 'target' && event.value > event.from ? Math.max(event.time, until) : event.time,
    }));
  }

  compare(event: { value: number; from: number }) {
    return event.value > event['from'];
  }

  current(p: Curve, event: { value: number; time: number }) {
    return event.value > p.valueAt(event.time);
  }
}

function unrelated(event: { from: number }) {
  return event.from;
}
