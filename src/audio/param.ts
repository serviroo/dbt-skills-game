/** Slider position (0..1) to gain: a squared taper, so the middle of the slider sounds like the middle. */
export const taper = (p: number) => {
  const x = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 1;
  return x * x;
};

/** A fade is silent once it is 90 dB down: under the -80 dB at which nothing of it is heard, with room to spare. */
const SILENT_DB = -90;

/** How long a setTargetAtTime fade to 0 with time constant `tau` takes to fall silent (SILENT_DB): about 10.4 tau. */
export const silentAfter = (tau: number) => tau * Math.log(10 ** (-SILENT_DB / 20));

/** Cancels what is scheduled from `t` on and holds the value automation gives at `t`, so a new ramp starts there. */
export function holdAt(p: AudioParam, t: number) {
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
  else {
    // without cancelAndHoldAtTime (Firefox): the getter's value, as of the last rendered block
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
  }
}
