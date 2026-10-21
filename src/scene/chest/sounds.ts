/**
 * Sound hooks for the audio module. The chest calls them; the audio module assigns them.
 * - rise(): the chest starts rising out of the pool (warm low swell)
 * - charge(c): every frame the charge changes, 0..1, including the drain after an early release
 * - full(): the charge reached 100 % (start of the hush)
 * - burst(): two frames after the burst visual (visuals lead audio)
 */
export const chestSounds: {
  rise?(): void;
  charge?(c: number): void;
  full?(): void;
  burst?(): void;
} = {};
