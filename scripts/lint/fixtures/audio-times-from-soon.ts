export function setVolume(ctx: AudioContext, volume: GainNode, level: number) {
  volume.gain.setTargetAtTime(level, ctx.currentTime, 0.05);
}

export function play(ctx: AudioContext, duck: GainNode, at?: number) {
  const start = Math.max(at ?? ctx.currentTime, ctx.currentTime);
  duck.gain.setTargetAtTime(0.7, start, 0.012);
}

export function fine(ctx: AudioContext, duck: GainNode, soon: (c: AudioContext) => number) {
  const start = soon(ctx);
  duck.gain.setTargetAtTime(0.7, start, 0.012);
  return document.timeline.currentTime;
}
