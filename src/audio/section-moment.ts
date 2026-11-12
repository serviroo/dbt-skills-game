import type { BedHandle, BedName } from './beds';
import type { Moment } from './moment';
import type { Music, Section } from './music';

export function sectionMoment(
  name: Section, moment: Moment, music: Music, shelf: AudioParam, beds: Map<BedName, BedHandle>,
  lifted: boolean, clearLift: () => void,
) {
  if (lifted) moment.add(0, (at) => music.lift(0, 0.3, at), shelf);
  // the gate hum and the aura belong to the dark world: they leave when the score lifts into D major
  const leaving = name === 'reward' || name === 'end' || name === 'calm'
    ? (['gate_hum', 'aura_bed'] as BedName[]).map((n) => beds.get(n)).filter((bed) => bed !== undefined)
    : [];
  const stops = leaving.map((bed) => bed.voice.prepareStop(moment, 2.5));
  return (at: number) => {
    if (lifted) clearLift();
    for (const finish of stops) finish(at);
  };
}
