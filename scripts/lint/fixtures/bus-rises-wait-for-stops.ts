export class Engine {
  duckG = new GainNode(new AudioContext());
  uiDuck = this.duckG;
  focus = this.duckG;
  yieldG = this.duckG;
  hushBeds = this.duckG;
  hushMusic = this.duckG;
  hushHall = this.duckG;
  hushRoom = this.duckG;
  safe = this.duckG;
  busLevels = { set(p: unknown, v: number, at: number, tau: number) { return [p, v, at, tau]; } };

  duck(at: number) {
    this.duckG.gain.cancelScheduledValues(at);
    this.duckG.gain.setTargetAtTime(1, at, 0.0075);
  }

  reset(at: number) {
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, at, 0.075);
    set(this.duckG.gain, 1);
  }

  aliases(at: number) {
    const gain = this.focus.gain;
    gain.setTargetAtTime(1, at, 0.1);
    for (const p of [this.hushBeds.gain, this.hushMusic.gain, this.hushHall.gain, this.hushRoom.gain]) {
      p.setTargetAtTime(1, at, 0.1);
    }
    this.focus.curve.setTargetAtTime(1, at, 0.1);
    const curve = this.safe.curve;
    curve.setTargetAtTime(1, at, 0.1);
    for (const p of [this.hushBeds.curve, this.hushMusic.curve]) p.setTargetAtTime(1, at, 0.1);
    const bus = this.uiDuck;
    bus.gain.setValueAtTime(1, at);
    for (const node of [this.yieldG]) node.gain.linearRampToValueAtTime(1, at);
  }

  quiet(at: number, on: boolean) {
    this.safe.gain.setTargetAtTime(1, at, 0.75);
    const p = this.safe.gain;
    p.setTargetAtTime(1, at, 0.75);
    for (const gain of on ? [this.safe.gain] : [this.safe.gain]) {
      gain.setTargetAtTime(1, at, 0.75);
    }
    this.busLevels.ramp(this.safe.curve, 1, at, at + 0.015);
  }

  throughHelper(at: number) {
    this.busLevels.set(this.duckG.curve, 1, at, 0.0075);
    this.busLevels.ramp(this.safe.curve, 0, at, at + 0.015);
    for (const p of [this.uiDuck.curve, this.focus.curve]) this.busLevels.set(p, 1, at, 0.075);
    const unrelated = new GainNode(new AudioContext());
    unrelated.gain.setTargetAtTime(1, at, 0.1);
  }
}
