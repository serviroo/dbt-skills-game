import type { Curve } from './curve';
import { holdAt } from './param';

type LevelEvent = Pick<ReturnType<Curve['scheduledFrom']>[number], 'kind' | 'value' | 'time' | 'tau'>;

function rising(value: number, from: number) {
  return value - from > Math.max(Math.abs(value), Math.abs(from)) * 1e-9;
}

function mergeAnchors(events: LevelEvent[]) {
  return events.filter((event, index) => {
    const next = events[index + 1];
    return next?.time !== event.time || (event.kind === 'linear' && next.kind !== 'linear');
  });
}

export class BusLevels {
  private stoppedUntil = 0;
  private levels = new Set<Curve>();

  constructor(private ctx: BaseAudioContext) {}

  set(p: Curve, value: number, at: number, tau: number, replace = true) {
    this.levels.add(p);
    const time = p.clampTime(at);
    const level = Math.fround(value);
    const from = p.valueAt(time);
    const start = rising(level, from) ? Math.max(time, this.stoppedUntil) : time;
    const next = p.scheduledFrom(time).find((event) => event.time > time);
    const falling = start > time && next?.kind === 'linear' && rising(from, next.value);
    if (replace) holdAt(p, falling ? Math.min(start, next.time) : time);
    this.write(p, { kind: 'target', value: level, time: start, tau });
  }

  ramp(p: Curve, value: 0, at: number, end: number) {
    this.levels.add(p);
    holdAt(p, at);
    this.write(p, { kind: 'linear', value, time: p.clampTime(end), tau: 0 });
  }

  hold(at: number, until: number) {
    this.stoppedUntil = Math.max(this.ctx.currentTime, until);
    for (const p of this.levels) {
      const time = p.clampTime(at);
      const pending = mergeAnchors(p.scheduledFrom(time));
      const deferred: LevelEvent[] = [];
      holdAt(p, time);
      for (const event of pending) {
        if (event.time >= this.stoppedUntil) {
          deferred.push(event);
        } else if (rising(event.value, p.valueAt(event.time))) {
          deferred.push({ ...event, time: this.stoppedUntil });
        } else {
          deferred.length = 0;
          this.write(p, event);
        }
      }
      let rampFrom = Math.max(time, this.stoppedUntil);
      const later = mergeAnchors(deferred.sort((a, b) => a.time - b.time));
      for (const [index, event] of later.entries()) {
        const keepsFalling = index === 0 && !rising(event.value, p.valueAt(rampFrom));
        if (event.kind === 'linear' && !keepsFalling) holdAt(p, rampFrom);
        this.write(p, event);
        rampFrom = event.time;
      }
    }
  }

  private write(p: Curve, event: LevelEvent) {
    if (event.kind === 'linear') {
      p.linearRampToValueAtTime(event.value, event.time);
      return;
    }
    holdAt(p, event.time);
    if (event.kind === 'target') p.setTargetAtTime(event.value, event.time, event.tau);
    else p.linearRampToValueAtTime(event.value, event.time);
  }
}
