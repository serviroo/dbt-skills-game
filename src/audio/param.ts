/** Cancels what is scheduled from `t` on and holds the value automation gives at `t`, so a new ramp starts there. */
export function holdAt(p: AudioParam, t: number) {
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
  else {
    // without cancelAndHoldAtTime (Firefox): the getter's value, as of the last rendered block
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
  }
}
