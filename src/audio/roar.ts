// brass and choir voiced around the Warden theme: none of them sits on a theme pitch in the theme's octave
// (D4 / F4 over Bb, E4 / G4 over C, A4 / D5 over Dm), so the horns read on top of the wall instead of inside it
export const prog: [number[], number[]][] = [
  [[34, 46, 53, 58, 70, 74, 77], [58, 70, 74]],
  [[36, 48, 55, 60, 72, 76, 79], [60, 72, 76]],
  [[38, 50, 57, 62, 65, 77, 81], [62, 65, 77]],
];
export const figs = [
  [58, 62, 65, 62, 70, 65, 62, 65, 58, 62, 65, 70, 74, 70, 65, 62],
  [60, 64, 67, 64, 72, 67, 64, 67, 60, 64, 67, 72, 76, 72, 67, 64],
  [62, 65, 69, 65, 74, 69, 65, 69, 62, 65, 69, 74, 77, 74, 69, 65],
];
// taiko groove over one bar of 16ths: [step, level]
export const groove: [number, number][] = [
  [0, 1], [3, 0.35], [6, 0.55], [8, 0.8], [10, 0.4], [11, 0.35], [12, 0.75], [14, 0.5], [15, 0.6],
];
// the Warden theme in horns and trombones (octaves): D-F over Bb, E-G over C, then A and the leap to D on the stand
export const theme = [[62, 65], [64, 67], [69, 74]];
