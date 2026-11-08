import type { AudioEngine, CueHandle, SoundEvent } from './engine';
import { BED_NAMES, type BedHandle, type BedName, type ChargeHandle } from './beds';
import type { ControlledBuild, Voice } from './voice';

type Setup = (built: ControlledBuild) => void;
type Entry = {
  built?: ControlledBuild;
  controls: { at: number; apply: Setup }[];
  end: number;
};
type Plan = { controls: Setup[]; bind?: Setup } & ({ event: SoundEvent } | { existing: ControlledBuild | undefined });
type Existing = {
  beds: ReadonlyMap<BedName, BedHandle>;
  charge: ChargeHandle | null;
  named: ReadonlyMap<string, CueHandle>;
  music: Voice[];
};

export function pendingEvents(events: SoundEvent[], t0: number, engine: AudioEngine, existing: Existing): Plan[] {
  const plans: { at: number; order: number; plan: Plan }[] = [];
  const reserves: { at: number; entry: Entry; apply: Setup }[] = [];
  const playing = new Map<Voice, Entry>();
  const bind = (built: ControlledBuild) => {
    let entry = playing.get(built.voice);
    if (!entry) {
      entry = { built, controls: [], end: built.voice.silentAt };
      playing.set(built.voice, entry);
    }
    return entry;
  };
  const beds = new Map<string, Entry>();
  for (const [name, handle] of existing.beds) if (!handle.stopped) {
    beds.set(name, bind({ voice: handle.voice, handle }));
  }
  const named = new Map<string, Entry>();
  for (const [id, handle] of existing.named) if (handle.voice) named.set(id, bind({ voice: handle.voice, handle }));
  let charge = existing.charge && !existing.charge.voice.isStopped
    ? bind({ voice: existing.charge.voice, handle: existing.charge }) : undefined;
  const sections = existing.music.filter((voice) => voice.silentAt > engine.ctx.currentTime)
    .map((voice) => bind({ voice }));
  let current: Entry | undefined;
  let order = 0;
  const deliver = (entry: Entry, at: number, apply: Setup) => {
    plans.push({ at, order, plan: { get existing() { return entry.built; }, controls: [apply] } });
  };
  const add = (entry: Entry, at: number, apply: Setup) => {
    if (entry === current) entry.controls.push({ at, apply });
    else {
      current = undefined;
      deliver(entry, at, apply);
    }
  };
  const reserve = (entry: Entry, at: number, ramp: number) => {
    entry.end = Math.min(entry.end, at);
    const apply = ({ voice }: ControlledBuild) => voice.stop(at, ramp, true);
    if (entry.built) reserves.push({ at, entry, apply });
    else entry.controls.push({ at, apply });
  };
  const stop = (entry: Entry, at: number, ramp: number) => {
    reserve(entry, at, ramp);
    deliver(entry, at, ({ voice, handle }) => {
      if (!handle?.stop) voice.stop(at, ramp);
      else if (handle.name) handle.stop(ramp, at);
      else handle.stop(at, ramp);
    });
  };
  for (const item of events.map((event, index) => ({ event, index })).sort((a, b) => a.event.t - b.event.t)) {
    const { event } = item;
    order = item.index;
    const { cue, loop } = event;
    const o = event.opts ?? {};
    const at = t0 + event.t;
    for (const [name, entry] of beds) if (entry.end <= at) beds.delete(name);
    if (charge && charge.end <= at) charge = undefined;
    const name = cue === 'bed' || cue === 'bed_stop' ? loop?.name : cue;
    const bed = beds.get(name ?? '');
    const scoreControl = ['music_level', 'music_lowpass', 'music_lift'].includes(cue);
    let target: Entry | undefined;
    if (cue === 'stop') target = named.get(o.id);
    else if (cue === 'bed_stop') target = bed;
    else if (cue === 'charge_stop' || cue === 'charge_release') target = charge;
    else if (scoreControl && current && sections.includes(current)) target = current;
    if (target) {
      if (cue === 'charge_release') add(target, at, ({ handle }) => handle?.release?.(at));
      else if (scoreControl) {
        const method = cue === 'music_level' ? 'level' : cue === 'music_lowpass' ? 'lowpass' : 'lift';
        const value = method === 'level' ? o.v ?? 1 : method === 'lowpass' ? o.hz ?? 20000 : o.db ?? 0;
        const apply = (time: number) => engine.music[method](value, o.ramp ?? (method === 'lift' ? 0.5 : 1), time);
        add(target, at, ({ voice }) => voice.control(at, apply, (_, time) => apply(time)));
      } else {
        const ramp = cue === 'bed_stop' ? o.fade ?? 0.5 : o.ramp ?? (cue === 'charge_stop' ? 0.03 : 0.04);
        stop(target, at, ramp);
        current = undefined;
        if (cue === 'bed_stop') beds.delete(name ?? '');
        if (cue === 'charge_stop') charge = undefined;
      }
      continue;
    }
    const isBed = cue === 'bed' || !!loop && BED_NAMES.includes(cue as BedName);
    if (isBed && bed) {
      add(bed, at, ({ handle }) => handle?.level?.(loop?.level ?? 1, o.fade ?? 0.5, at));
      if (loop?.until !== undefined) stop(bed, t0 + loop.until, o.fadeOut ?? 0.5);
      continue;
    }
    if (cue === 'charge' && charge) {
      const value = o.c ?? loop?.level;
      if (value !== undefined) add(charge, at, ({ handle }) => handle?.set?.(value, at));
      if (loop?.until !== undefined) stop(charge, t0 + loop.until, 0.03);
      continue;
    }
    if (cue === 'reset') {
      for (const entry of new Set([...beds.values(), ...named.values(), ...sections, ...charge ? [charge] : []])) {
        reserve(entry, at, o.fade ?? 0.3);
      }
      beds.clear();
      named.clear();
      sections.length = 0;
      charge = undefined;
    }
    if (cue === 'music' || cue === 'music_stop') {
      for (const section of sections) reserve(section, at, o.fadeOut ?? o.fade ?? (cue === 'music' ? 2 : 1));
    }
    const entry: Entry = { controls: [], end: Infinity };
    current = entry;
    plans.push({ at, order, plan: { event, bind(built) { entry.built = built; }, get controls() {
      return entry.controls.sort((a, b) => a.at - b.at).map((control) => control.apply);
    } } });
    if (o.id && !isBed && cue !== 'charge' && cue !== 'music' && cue !== 'stop') named.set(o.id, entry);
    if (isBed) beds.set(name ?? '', entry);
    if (cue === 'charge') {
      charge = entry;
      const value = o.c ?? loop?.level;
      if (value !== undefined) add(entry, at, ({ handle }) => handle?.set?.(value, at));
    }
    if (isBed || cue === 'charge') {
      if (loop?.until !== undefined) stop(entry, t0 + loop.until, isBed ? o.fadeOut ?? 0.5 : 0.03);
    }
    if (cue === 'music') sections.push(entry);
  }
  const prepared = reserves.sort((a, b) => a.at - b.at).map(({ entry, apply }) =>
    ({ existing: entry.built, controls: [apply] }));
  return [...prepared, ...plans.sort((a, b) => a.at - b.at || a.order - b.order).map(({ plan }) => plan)];
}
