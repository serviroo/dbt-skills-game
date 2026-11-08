import { type Ctx } from './dsp';
import { soon } from './param';
import { type Voice } from './voice';

export class CueCleanup {
  private pending = new Map<Voice, number>();
  private clock: ConstantSourceNode | null = null;

  constructor(private ctx: Ctx, private output: AudioNode, private active: Set<Voice>) {}

  add(voice: Voice) {
    this.pending.set(voice, Math.max(voice.end, soon(this.ctx)) + 4);
    this.arm();
  }

  private arm() {
    const next = Math.max(Math.min(...this.pending.values()), soon(this.ctx));
    if (!this.clock) {
      const clock = this.ctx.createConstantSource();
      this.clock = clock;
      clock.offset.value = 0;
      clock.connect(this.output);
      clock.onended = () => {
        clock.disconnect();
        this.clock = null;
        const through = this.ctx.currentTime;
        for (const [voice, by] of this.pending) {
          if (by > through) continue;
          voice.stop(soon(this.ctx), 0);
          voice.out.disconnect();
          this.active.delete(voice);
          this.pending.delete(voice);
        }
        if (this.pending.size) this.arm();
      };
      clock.start();
    }
    const quantum = 128 / this.ctx.sampleRate;
    this.clock.stop(Math.ceil(next / quantum) * quantum);
  }

  dispose() {
    if (this.clock) {
      this.clock.onended = null;
      this.clock.stop();
      this.clock.disconnect();
      this.clock = null;
    }
    for (const voice of this.pending.keys()) {
      voice.out.disconnect();
      this.active.delete(voice);
    }
    this.pending.clear();
  }
}
