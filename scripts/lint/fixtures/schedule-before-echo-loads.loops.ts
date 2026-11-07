declare function soon(ctx: BaseAudioContext): number;

export class Engine {
  ctx = new AudioContext();
  out = this.ctx.createGain();

  staleFor(at = soon(this.ctx)) {
    const old = at;
    this.ctx.createConvolver();
    at = soon(this.ctx);
    let end = at + 0.02;
    for (let i = 0; i < 2; i++) {
      this.out.gain.setValueAtTime(0, end);
      end = old;
    }
  }

  staleWhile(at = soon(this.ctx)) {
    const old = at;
    this.ctx.createConvolver();
    at = soon(this.ctx);
    let end = at + 0.02;
    while (end) {
      this.out.gain.setValueAtTime(0, end);
      end = old;
    }
  }

  staleDoWhile(at = soon(this.ctx)) {
    const old = at;
    this.ctx.createConvolver();
    at = soon(this.ctx);
    let end = at + 0.02;
    do {
      this.out.gain.setValueAtTime(0, end);
      end = old;
    } while (end);
  }

  staleDoWhileCondition(at = soon(this.ctx)) {
    const old = at;
    this.ctx.createConvolver();
    at = soon(this.ctx);
    let end = at + 0.02;
    let i = 0;
    do { this.out.gain.setValueAtTime(0, end); } while ((end = old, ++i < 2));
  }

  staleForOf(at = soon(this.ctx)) {
    const old = at;
    this.ctx.createConvolver();
    at = soon(this.ctx);
    let end = at + 0.02;
    for (const value of [0, 1]) {
      this.out.gain.setValueAtTime(value, end);
      end = old;
    }
  }

  staleForIn(at = soon(this.ctx)) {
    const old = at;
    this.ctx.createConvolver();
    at = soon(this.ctx);
    let end = at + 0.02;
    for (const key in { first: 0, second: 1 }) {
      this.out.gain.setValueAtTime(key.length, end);
      end = old;
    }
  }

  staleNestedLoop(at = soon(this.ctx)) {
    const old = at;
    this.ctx.createConvolver();
    for (let i = 0; i < 2; i++) {
      at = soon(this.ctx);
      let end = at + 0.02;
      for (let j = 0; j < 2; j++) {
        this.out.gain.setValueAtTime(0, end);
        if (j) end = old;
      }
    }
  }

  staleLoopDependency(at = soon(this.ctx)) {
    const old = at;
    this.ctx.createConvolver();
    at = soon(this.ctx);
    for (let i = 0; i < 2; i++) {
      const end = at + 0.02;
      let stop = end + 0.02;
      this.out.gain.setValueAtTime(0, stop);
      at = old;
    }
  }

  staleLoopSubtraction(at = soon(this.ctx)) {
    this.ctx.createConvolver();
    at = soon(this.ctx);
    let end = at + 0.02;
    for (let i = 0; i < 2; i++) {
      this.out.gain.setValueAtTime(0, end);
      const now = soon(this.ctx);
      end = now - 0.02;
    }
  }

  staleLoopCompound(at = soon(this.ctx)) {
    this.ctx.createConvolver();
    at = soon(this.ctx);
    let end = at + 0.02;
    for (let i = 0; i < 2; i++) {
      this.out.gain.setValueAtTime(0, end);
      end -= 999;
    }
  }

  freshEachIteration(at = soon(this.ctx)) {
    const old = at;
    this.ctx.createConvolver();
    for (let i = 0; i < 2; i++) {
      at = soon(this.ctx);
      let end = at + 0.02;
      this.out.gain.setValueAtTime(0, end);
      end = old;
    }
  }

  staleOutsideLoop(at = soon(this.ctx)) {
    const old = at;
    this.ctx.createConvolver();
    at = soon(this.ctx);
    let end = at + 0.02;
    for (let i = 0; i < 2; i++) this.out.gain.setValueAtTime(0, end);
    setTimeout(() => this.out.gain.setValueAtTime(0, end), 0);
    end = old;
  }

  staleSubtractions(at = soon(this.ctx)) {
    const fixed = 0.02;
    let compound = at;
    let difference = at;
    let cancellation = at;
    let negativeOffset = at;
    this.ctx.createConvolver();
    compound = soon(this.ctx);
    compound -= 999;
    this.out.gain.setValueAtTime(0, compound);
    difference = soon(this.ctx);
    difference = difference - fixed;
    this.out.gain.setValueAtTime(0, difference);
    cancellation = soon(this.ctx);
    cancellation = cancellation - cancellation;
    this.out.gain.setValueAtTime(0, cancellation);
    negativeOffset = soon(this.ctx);
    negativeOffset += -fixed;
    this.out.gain.setValueAtTime(0, negativeOffset);
    at = soon(this.ctx) + -fixed;
    this.out.gain.setValueAtTime(0, at);
  }

  shadowedMath(at = soon(this.ctx)) {
    const old = at;
    const Math = { max: (..._values: number[]) => old };
    this.ctx.createConvolver();
    at = soon(this.ctx);
    let end = at + 0.02;
    end = Math.max(at, 0.02);
    this.out.gain.setValueAtTime(0, end);
  }

  outerShadowedMath(at = soon(this.ctx)) {
    const old = at;
    const Math = { min: (..._values: number[]) => old };
    const play = (at = soon(this.ctx)) => {
      this.ctx.createConvolver();
      at = soon(this.ctx);
      let end = at + 0.02;
      end = Math.min(at, 0.02);
      this.out.gain.setValueAtTime(0, end);
    };
    return play;
  }

  fixedRefresh(at = soon(this.ctx)) {
    this.ctx.createConvolver();
    at = 0.5;
    this.out.gain.setValueAtTime(0, at);
  }

  fixedMathRefresh(at = soon(this.ctx)) {
    this.ctx.createConvolver();
    at = Math.max(0.5, 0.02);
    this.out.gain.setValueAtTime(0, at);
  }

  fixedConstRefresh(at = soon(this.ctx)) {
    const offset = 0.5;
    this.ctx.createConvolver();
    at = (offset satisfies number)!;
    this.out.gain.setValueAtTime(0, at);
  }

  fixedSumRefresh(at = soon(this.ctx)) {
    this.ctx.createConvolver();
    at = 0.5 + 0.02;
    this.out.gain.setValueAtTime(0, at);
  }

  freshGlobalMath(at = soon(this.ctx)) {
    this.ctx.createConvolver();
    at = soon(this.ctx);
    const end = Math.max(0.02, at + 0.02);
    this.out.gain.setValueAtTime(0, end);
  }

  conditionalSoonIsOverReported(c: boolean, at = soon(this.ctx)) {
    this.ctx.createConvolver();
    at = c ? soon(this.ctx) : soon(this.ctx);
    this.out.gain.setValueAtTime(0, at);
  }

  multipliedSoonIsOverReported(at = soon(this.ctx)) {
    this.ctx.createConvolver();
    at = soon(this.ctx) * 2;
    this.out.gain.setValueAtTime(0, at);
  }

  wrappedSoonIsOverReported(f: (at: number) => number, at = soon(this.ctx)) {
    this.ctx.createConvolver();
    at = f(soon(this.ctx));
    this.out.gain.setValueAtTime(0, at);
  }
}
