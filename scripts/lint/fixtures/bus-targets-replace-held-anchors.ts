class BusLevels {
  set(p: Curve, value: number, at: number, tau: number, replace = true) {
    const time = p.clampTime(at);
    const from = p.valueAt(time);
    const start = value > from ? Math.max(time, this.stoppedUntil) : time;
    const next = p.scheduledFrom(time).find((event) => event.time > time);
    const falling = start > time && next?.kind === 'linear' && next.value < from;
    if (replace) holdAt(p, falling ? Math.min(start, next.time) : time);
    p.setTargetAtTime(value, start, tau);
  }

  append(p: Curve, value: number, at: number, tau: number) {
    p.setTargetAtTime(value, at, tau);
  }

  wrongTime(p: Curve, value: number, at: number, tau: number) {
    holdAt(p, at);
    p.setTargetAtTime(value, at + 1, tau);
  }

  write(p: Curve, event: { value: number; time: number; tau: number }) {
    holdAt(p, event.time);
    if (event.tau > 0) p.setTargetAtTime(event.value, event.time, event.tau);
  }
}
