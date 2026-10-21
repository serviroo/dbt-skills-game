import type { SoundEvent } from './engine';

/**
 * The cutscene soundtrack as an event list, timed to the beat sheet. Times after 54.0 s follow their hold:
 * pass the captured run's holdStart / holdEnd (charge full) / letterAt / rowsAt / endAt to stay in sync.
 * `charge` is an optional sampled charge curve [[t, c], ...] in cutscene seconds; default is a 1.5 s ignition-curve hold.
 */
export function cutsceneEvents(o: { holdStart?: number; holdEnd?: number; letterAt?: number; rowsAt?: number; endAt?: number; charge?: [number, number][] } = {}): SoundEvent[] {
  const hs = o.holdStart ?? 54.0;
  const he = o.holdEnd ?? 55.5;
  const burst = he + 0.2;
  const letter = o.letterAt ?? Math.max(60.0, burst + 4.3);
  const rows = o.rowsAt ?? letter + 10;
  const endAt = o.endAt ?? Math.max(76.0, rows + 3);
  const ev: SoundEvent[] = [
    { t: 0.5, cue: 'music', opts: { section: 'intro', fade: 0.6 } },
    { t: 1.8, cue: 'gate_air' },
    { t: 1.9, cue: 'gate_swell' },
    { t: 1.933, cue: 'gate_crack' },
    { t: 2.1, cue: 'bed', loop: { name: 'gate_hum', level: 1, until: 22.0 }, opts: { fade: 1.6, fadeOut: 0.05 } },
    { t: 6.6, cue: 'duck', opts: { db: -3, ramp: 0.4 } },
    { t: 7.2, cue: 'music', opts: { section: 'windows', fade: 1.2 } },
    { t: 7.233, cue: 'ui_open' },
    { t: 14.0, cue: 'ui_close' },
    { t: 14.25, cue: 'ui_open', opts: { detune: 500 } },
    { t: 14.23, cue: 'music_lift', opts: { db: 5, ramp: 0.3 } },
  ];
  const N = 12;
  for (let k = 1; k <= N; k++) {
    const x = 1 - Math.cbrt(1 - k / N);
    ev.push({ t: 15.0 + 1.2 * x, cue: 'level_tick', opts: { detune: k * 40, gain: 0.9 } });
  }
  ev.push(
    { t: 16.2, cue: 'level_ring' },
    { t: 17.3, cue: 'level_resolve' },
    { t: 21.6, cue: 'music_lift', opts: { db: 0, ramp: 0.4 } },
    { t: 22.0, cue: 'duck', opts: { db: 0, ramp: 0.05 } },
    { t: 22.0, cue: 'music', opts: { section: 'silhouette', fade: 0.4, fadeOut: 0.06 } },
    { t: 22.0, cue: 'bed', loop: { name: 'aura_bed', level: 1 }, opts: { fade: 0.25 } },
    { t: 28.4, cue: 'music_level', opts: { v: 0.72, ramp: 4 } },
    { t: 34.1, cue: 'eye_swell' },
    { t: 35.8, cue: 'music_lowpass', opts: { hz: 520, ramp: 0.5 } },
    { t: 35.8, cue: 'bed', loop: { name: 'aura_bed', level: 0.45 }, opts: { fade: 0.5 } },
    { t: 36.0, cue: 'music', opts: { section: 'awaken', fade: 0.8, fadeOut: 0.5, hitAt: 40.86, standAt: 47.9 } },
    { t: 36.05, cue: 'music_lowpass', opts: { hz: 20000, ramp: 0.6 } },
    { t: 36.0, cue: 'music_level', opts: { v: 1, ramp: 0.6 } },
    { t: 40.08, cue: 'bed_stop', loop: { name: 'aura_bed' }, opts: { fade: 0.03 } },
    { t: 40.86, cue: 'awaken_hit' },
    { t: 40.92, cue: 'riser' },
    { t: 41.0, cue: 'bed', loop: { name: 'vortex_roar', level: 0.4 }, opts: { fade: 0.6 } },
    { t: 41.16, cue: 'whoosh' },
    { t: 41.6, cue: 'bed', loop: { name: 'vortex_roar', level: 1 }, opts: { fade: 0.12 } },
    { t: 43.44, cue: 'bed', loop: { name: 'vortex_roar', level: 0.8 }, opts: { fade: 0.8 } },
    { t: 44.98, cue: 'soldier_ignite' },
    { t: 46.95, cue: 'stand_swell', opts: { id: 'stand' } },
    { t: 49.84, cue: 'stop', opts: { id: 'stand', ramp: 0.04 } },
    { t: 49.84, cue: 'bed', loop: { name: 'vortex_roar', level: 0.3, until: 50.6 }, opts: { fade: 0.04, fadeOut: 1.2 } },
    { t: 49.84, cue: 'music', opts: { section: 'reward', fade: 3.5, fadeOut: 0.04 } },
    { t: 49.87, cue: 'ui_open' },
    { t: 52.0, cue: 'ui_close' },
    { t: 52.2, cue: 'chest_rise' },
    { t: hs, cue: 'charge', opts: { c: 0 } },
  );
  const curve = o.charge ?? Array.from({ length: 31 }, (_, i) => {
    const x = i / 30;
    return [hs + (he - hs) * x, x] as [number, number];
  });
  for (const [t, c] of curve) ev.push({ t, cue: 'charge', opts: { c } });
  ev.push(
    { t: he, cue: 'charge_stop', opts: { ramp: 0.03 } },
    { t: he, cue: 'hush', opts: { until: burst } },
    { t: burst, cue: 'chest_burst' },
    { t: burst + 0.8, cue: 'reward_chime' },
    { t: letter, cue: 'letter_open' },
    { t: letter, cue: 'music_level', opts: { v: 0.8, ramp: 2 } },
    { t: rows, cue: 'soft_chime', opts: { gain: 0.6 } },
    { t: rows + 0.3, cue: 'soft_chime', opts: { gain: 0.6, detune: 200 } },
    { t: rows + 0.6, cue: 'soft_chime', opts: { gain: 0.6, detune: 500 } },
    { t: endAt, cue: 'endcard' },
    { t: endAt, cue: 'music', opts: { section: 'end', fade: 2.5, fadeOut: 2.0 } },
    { t: endAt, cue: 'music_level', opts: { v: 1, ramp: 1 } },
    { t: endAt + 2.0, cue: 'bed', loop: { name: 'ambient', level: 1 }, opts: { fade: 4 } },
  );
  return ev;
}

/** A 20 s condensed run of the cutscene cues in order (QA demo). */
export function demoEvents(): SoundEvent[] {
  const ev: SoundEvent[] = [
    { t: 0.0, cue: 'music', opts: { section: 'intro', fade: 0.6 } },
    { t: 0.55, cue: 'gate_air' },
    { t: 0.65, cue: 'gate_swell' },
    { t: 0.683, cue: 'gate_crack' },
    { t: 0.8, cue: 'bed', loop: { name: 'gate_hum', level: 1, until: 6.0 }, opts: { fade: 1.0, fadeOut: 0.05 } },
    { t: 1.9, cue: 'music', opts: { section: 'windows', fade: 0.8 } },
    { t: 2.0, cue: 'ui_open' },
    { t: 3.2, cue: 'ui_close' },
    { t: 3.45, cue: 'ui_open', opts: { detune: 500 } },
    { t: 3.45, cue: 'music_lift', opts: { db: 5, ramp: 0.3 } },
  ];
  for (let k = 1; k <= 8; k++) ev.push({ t: 3.8 + 0.8 * (1 - Math.cbrt(1 - k / 8)), cue: 'level_tick', opts: { detune: k * 60 } });
  ev.push(
    { t: 4.6, cue: 'level_ring' },
    { t: 5.6, cue: 'level_resolve' },
    { t: 6.0, cue: 'music_lift', opts: { db: 0, ramp: 0.1 } },
    { t: 6.0, cue: 'music', opts: { section: 'silhouette', fade: 0.3, fadeOut: 0.06 } },
    { t: 6.0, cue: 'bed', loop: { name: 'aura_bed', level: 1, until: 9.2 }, opts: { fade: 0.25, fadeOut: 0.03 } },
    { t: 6.8, cue: 'eye_swell' },
    { t: 7.6, cue: 'music', opts: { section: 'awaken', fade: 0.5, fadeOut: 0.4, hitAt: 10.0, standAt: 13.4 } },
    { t: 10.0, cue: 'awaken_hit' },
    { t: 10.06, cue: 'riser' },
    { t: 10.1, cue: 'bed', loop: { name: 'vortex_roar', level: 0.4 }, opts: { fade: 0.5 } },
    { t: 10.3, cue: 'whoosh' },
    { t: 10.7, cue: 'bed', loop: { name: 'vortex_roar', level: 1 }, opts: { fade: 0.12 } },
    { t: 11.9, cue: 'soldier_ignite' },
    { t: 12.45, cue: 'stand_swell', opts: { id: 'stand' } },
    { t: 14.3, cue: 'stop', opts: { id: 'stand', ramp: 0.04 } },
    { t: 14.3, cue: 'bed', loop: { name: 'vortex_roar', level: 0.3, until: 15.0 }, opts: { fade: 0.04, fadeOut: 1.0 } },
    { t: 14.3, cue: 'music', opts: { section: 'reward', fade: 2.0, fadeOut: 0.04 } },
    { t: 14.33, cue: 'ui_open' },
    { t: 14.9, cue: 'chest_rise' },
    { t: 15.6, cue: 'charge', opts: { c: 0 } },
  );
  for (let i = 0; i <= 20; i++) ev.push({ t: 15.8 + 0.06 * i, cue: 'charge', opts: { c: i / 20 } });
  ev.push(
    { t: 17.0, cue: 'charge_stop' },
    { t: 17.0, cue: 'hush', opts: { until: 17.2 } },
    { t: 17.2, cue: 'chest_burst' },
    { t: 18.0, cue: 'reward_chime' },
    { t: 18.7, cue: 'endcard' },
    { t: 18.7, cue: 'music', opts: { section: 'end', fade: 1.0, fadeOut: 1.0 } },
  );
  return ev;
}

/** Events in [from, to) re-timed to start at 0: schedule one beat at a time so audio can't drift from the picture. */
export function segment(events: SoundEvent[], from: number, to: number): SoundEvent[] {
  return events
    .filter((e) => e.t >= from && e.t < to)
    .map((e) => {
      const o = e.opts ? { ...e.opts } : undefined;
      if (o && typeof o.hitAt === 'number') o.hitAt -= from;
      if (o && typeof o.standAt === 'number') o.standAt -= from;
      if (o && typeof o.until === 'number') o.until -= from;
      return { ...e, t: e.t - from, opts: o, loop: e.loop ? { ...e.loop, until: e.loop.until !== undefined ? e.loop.until - from : undefined } : undefined };
    });
}

/** The capture logger's record (src/cutscene/audio-log.ts): stage time + call. */
export interface LoggedCall {
  t: number;
  kind: string;
  name: string;
  args: number[];
  opts?: Record<string, number>;
}

/**
 * Converts the director's logged audio calls into renderOffline events, so a deterministic capture gets the exact
 * soundtrack the live app would have played. Pass the capture's start time as t0 if the log does not start at 0.
 */
export function fromLog(log: LoggedCall[], t0 = 0): SoundEvent[] {
  const ev: SoundEvent[] = [];
  for (const c of log) {
    const t = c.t - t0;
    if (t < 0) continue;
    switch (c.kind) {
      case 'play':
        ev.push({ t, cue: c.name, opts: c.opts });
        break;
      case 'bed':
        ev.push({ t, cue: 'bed', loop: { name: c.name, level: c.args[0] ?? 1 }, opts: { fade: c.args[1] || 0.05 } });
        break;
      case 'charge':
        if (c.name === 'start') ev.push({ t, cue: 'charge', opts: { c: 0 } });
        else if (c.name === 'set') ev.push({ t, cue: 'charge', opts: { c: c.args[0] ?? 0 } });
        else if (c.name === 'release') ev.push({ t, cue: 'charge_release' });
        else if (c.name === 'stop') ev.push({ t, cue: 'charge_stop' });
        break;
      case 'music':
        ev.push({ t, cue: 'music', opts: { section: c.name, fade: c.args[0] ?? 1, ...(c.opts ?? {}) } });
        break;
      case 'duck':
        ev.push({ t, cue: 'duck', opts: { db: c.args[0] ?? 0, ramp: c.args[1] ?? 0.4 } });
        break;
      case 'hush':
        ev.push({ t, cue: 'hush', opts: c.args[0] !== undefined ? { until: c.args[0] - t0 } : {} });
        break;
      case 'unhush':
        ev.push({ t, cue: 'unhush' });
        break;
    }
  }
  return ev;
}
