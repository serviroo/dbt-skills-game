import type { AudioEngine, SoundEvent } from './engine';
import { BED_NAMES, type BedHandle, type BedName, type ChargeHandle } from './beds';
import type { ControlledBuild, Voice } from './voice';

type Setup = (built: ControlledBuild) => void;
export type Entry = {
  built?: ControlledBuild;
  controls: { at: number; apply: Setup }[];
  end: number;
};
export type Plan = { controls: Setup[]; bind?: Setup }
  & ({ event: SoundEvent } | { existing: ControlledBuild | undefined });
type Kind = 'cue' | 'bed' | 'charge' | 'section' | 'hush' | 'reset' | 'other';
export type Waiting = { kind: Kind; key?: string; entry: Entry };
type Named = Map<string, { at: number; entry?: Entry }[]>;
type Existing = {
  beds: ReadonlyMap<BedName, BedHandle>;
  charge: ChargeHandle | null;
  music: Voice[];
};
const CONTROLS = ['stop', 'bed_stop', 'charge_release', 'charge_stop', 'music_stop', 'music_level', 'music_lowpass',
  'music_lift', 'unhush', 'duck'];
const soundAt = (named: Named, id: string, at: number) => named.get(id)?.filter((n) => n.at <= at).at(-1)?.entry;
const nameAt = (named: Named, id: string, at: number, entry?: Entry) =>
  named.set(id, [...named.get(id) ?? [], { at, entry }].sort((a, b) => a.at - b.at));

function pendingEvents(
  events: SoundEvent[], t0: number, engine: AudioEngine, existing: Existing, waiting: Waiting[], named: Named,
): { at: number; plan: Plan; waiting?: Waiting }[] {
  const plans: { at: number; order: number; plan: Plan; waiting?: Waiting }[] = [];
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
  let charge = existing.charge && !existing.charge.voice.isStopped
    ? bind({ voice: existing.charge.voice, handle: existing.charge }) : undefined;
  const sections = existing.music.filter((voice) => voice.silentAt > engine.ctx.currentTime)
    .map((voice) => bind({ voice }));
  for (const { kind, key, entry } of waiting) {
    if (kind === 'bed' && key) beds.set(key, entry);
    else if (kind === 'charge') charge = entry;
    else if (kind === 'section') sections.push(entry);
  }
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
    if (cue === 'stop') target = soundAt(named, o.id, at);
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
      const cues = [...named.keys()].map((id) => soundAt(named, id, at)).filter((e) => !!e);
      for (const entry of new Set([...beds.values(), ...cues, ...sections, ...charge ? [charge] : []])) {
        reserve(entry, at, o.fade ?? 0.3);
      }
      for (const id of named.keys()) nameAt(named, id, at);
      beds.clear();
      sections.length = 0;
      charge = undefined;
    }
    if (cue === 'music' || cue === 'music_stop') {
      for (const section of sections) reserve(section, at, o.fadeOut ?? o.fade ?? (cue === 'music' ? 2 : 1));
    }
    const entry: Entry = { controls: [], end: Infinity };
    current = entry;
    const kind: Kind = isBed ? 'bed' : cue === 'charge' ? 'charge' : cue === 'music' ? 'section'
      : cue === 'hush' ? 'hush' : cue === 'reset' ? 'reset' : CONTROLS.includes(cue) ? 'other' : 'cue';
    plans.push({ at, order, waiting: { kind, key: isBed ? name : o.id, entry }, plan: {
      event, bind(built) { entry.built = built; }, get controls() {
        return entry.controls.sort((a, b) => a.at - b.at).map((control) => control.apply);
      } } });
    if (o.id && kind === 'cue') nameAt(named, o.id, at, entry);
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
    ({ at: -Infinity, plan: { existing: entry.built, controls: [apply] } }));
  return [...prepared, ...plans.sort((a, b) => a.at - b.at || a.order - b.order)];
}

type Queued = { at: number; batch: number; gen: number; item: Waiting; run: () => void };

export class Timeline {
  private queued: Queued[] = [];
  private batches = 0;
  private running = Infinity;
  private gen = 0;
  private cuts: { gen: number; at: number }[] = [];
  private named: Named = new Map();

  constructor(private engine: AudioEngine, private quiet: () => boolean) {}

  schedule(events: SoundEvent[], t0: number, existing: Existing, run: (plan: Plan) => void, until: number) {
    const now = this.engine.ctx.currentTime;
    for (const [id, list] of this.named) {
      const kept = list.filter((n) => !n.entry?.built || n.entry.built.voice.silentAt > now);
      if (kept.length) this.named.set(id, kept);
      else this.named.delete(id);
    }
    const batch = ++this.batches;
    for (const { at, plan, waiting } of pendingEvents(events, t0, this.engine, existing, this.waiting, this.named)) {
      if (waiting?.kind === 'reset') this.cuts.push({ gen: ++this.gen, at });
      const item = waiting ?? { kind: 'other', entry: { controls: [], end: at } };
      this.queued.push({ at, batch, gen: this.gen, item, run: () => run(plan) });
    }
    this.queued.sort((a, b) => a.at - b.at || a.batch - b.batch);
    this.until(until);
  }

  until(t: number) {
    while (this.queued.length && this.queued[0].at <= t) this.run(this.queued.shift()!);
  }

  bump(at: number, forget = false) {
    if (this.running !== Infinity) return;
    const due = this.queued.filter((q) => q.at < at);
    this.queued = this.queued.filter((q) => q.at >= at);
    for (const q of due) this.run(q);
    this.cuts.push({ gen: ++this.gen, at });
    if (forget) this.named.clear();
  }

  private run(q: Queued) {
    const cut = this.cuts.some((c) => q.gen < c.gen && q.at >= c.at);
    this.cuts = this.cuts.filter((c) => this.queued.some((other) => other.gen < c.gen));
    if (cut || (q.item.kind !== 'other' && q.item.kind !== 'reset' && this.quiet())) return;
    const was = this.running;
    this.running = q.batch;
    try {
      q.run();
    } finally {
      this.running = was;
    }
  }

  get waiting() {
    return this.queued.map((q) => q.item);
  }

  sound(id: string) {
    return this.named.get(id)?.at(-1)?.entry?.built?.voice;
  }

  reach(match: (item: Waiting) => boolean, at: number) {
    const reached = this.queued.filter((q) => q.batch < this.running && match(q.item));
    this.queued = this.queued.filter((q) => !reached.includes(q));
    for (const q of reached) if (q.at < at) this.run(q);
  }
}
