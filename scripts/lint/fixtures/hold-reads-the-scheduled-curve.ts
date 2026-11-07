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

export function scheduled(gain: GainNode, ctx: BaseAudioContext, at: number) {
  const param = gain.gain;
  trackParam(param, ctx, 1);
  gain.gain.setValueAtTime(0.5, at);
  param.linearRampToValueAtTime(0.5, at);
  gain.gain.exponentialRampToValueAtTime(0.5, at);
  param.setTargetAtTime(0.5, at, 0.1);
  gain.gain.setValueCurveAtTime([0.5, 0.6], at, 1);
  param.cancelScheduledValues(at);
  gain.gain.cancelAndHoldAtTime(at);
}

class Stored {
  safe: GainNode;
  constructor(ctx: BaseAudioContext) {
    this.safe = ctx.createGain();
    trackParam(this.safe.gain, ctx, 1);
  }
  change(at: number) {
    this.safe.gain.setValueAtTime(0.2, at);
    this.safe.gain.linearRampToValueAtTime(0.2, at);
    this.safe.gain.exponentialRampToValueAtTime(0.2, at);
    this.safe.gain.setTargetAtTime(0.5, at, 0.1);
    this.safe.gain.setValueCurveAtTime([0.2, 0.5], at, 1);
    this.safe.gain.cancelScheduledValues(at);
    this.safe.gain.cancelAndHoldAtTime(at);
  }
}

export function factory(ctx: BaseAudioContext, at: number) {
  const gain = trackedGain(ctx, 1);
  const param = gain.gain;
  param['setTargetAtTime'](0.5, at, 0.1);
  gain['gain'].cancelScheduledValues(at);
  gain.gain.setValueAtTime(0.5, at).linearRampToValueAtTime(0.2, at + 1);
  gain.curve.setTargetAtTime(0.5, at, 0.1);
}
