export function oldHold(p: AudioParam, t: number) {
  p.cancelAndHoldAtTime(t);
  p.setValueAtTime(p.value, t);
}

export function copied(a: GainNode, b: GainNode, t: number) {
  a.gain.value = b.gain.value;
  const level = b.gain.value;
  a.gain.setTargetAtTime(level, t, 0.1);
  const p = b.gain;
  a.gain.linearRampToValueAtTime(p.value, t);
}

export function allowed(a: GainNode, input: HTMLInputElement, t: number) {
  a.gain.value = 0.5;
  a.gain.setValueAtTime(Number(input.value), t);
  return { displayed: a.gain.value };
}

export function held(p: { valueAt(t: number): number; setValueAtTime(v: number, t: number): void }, t: number) {
  p.setValueAtTime(p.valueAt(t), t);
}

export function tracked(gain: GainNode, ctx: BaseAudioContext) {
  const param = gain.gain;
  trackParam(param, ctx);
  param.value = 0.25;
  gain.gain.value = 0.5;
}

export function initialized(gain: GainNode, ctx: BaseAudioContext) {
  gain.gain.value = 0.5;
  trackParam(gain.gain, ctx);
}

export function separate(gain: GainNode, other: GainNode, ctx: BaseAudioContext) {
  trackParam(gain.gain, ctx);
  other.gain.value = 0.25;
}
