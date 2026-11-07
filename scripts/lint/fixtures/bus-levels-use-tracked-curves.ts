import { trackedGain } from '../../../src/audio/curve';
import { BusLevels } from '../../../src/audio/bus-levels';

export class Engine {
  ctx = new AudioContext();
  busLevels = new BusLevels(this.ctx);
  duckG = trackedGain(this.ctx, 1);
  safe = trackedGain(this.ctx, 1);

  create() {
    this.duckG = this.ctx.createGain();
    this.safe = this.ctx.createGain();
  }

  stop(at: number) {
    this.busLevels.set(this.duckG.gain, 1, at, 0.1);
    const p = this.safe.gain;
    this.busLevels.set(p, 1, at, 0.1);
    this.busLevels.ramp(this.safe.gain, 0, at, at + 0.1);
  }

  tracked(at: number) {
    this.duckG = trackedGain(this.ctx, 1);
    this.busLevels.set(this.duckG.curve, 1, at, 0.1);
    this.busLevels.ramp(this.safe.curve, 0, at, at + 0.1);
  }
}
