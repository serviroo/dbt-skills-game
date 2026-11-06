declare function soon(ctx: BaseAudioContext): number;

export class Engine {
  ctx = new AudioContext();
  out = this.ctx.createGain();
  echo = this.makeEcho();

  makeEcho() {
    const c = this.ctx.createConvolver();
    c.connect(this.out);
    return c;
  }

  stopAll(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    this.out.gain.setTargetAtTime(0, at, 0.01);
  }

  stopFirst(at = soon(this.ctx)) {
    this.out.gain.setTargetAtTime(0, at, 0.01);
    this.echo = this.makeEcho();
  }

  reset() {
    const at = soon(this.ctx);
    const level = (v: number) => this.out.gain.setTargetAtTime(v, at, 0.01);
    function rise(gain: GainNode) {
      gain.gain.setTargetAtTime(1, at, 0.01);
    }
    this.stopFirst(at);
    level(1);
    rise(this.out);
  }

  twice() {
    this.echo = this.makeEcho();
    const at = soon(this.ctx);
    this.echo = this.makeEcho();
    this.out.gain.setTargetAtTime(1, at, 0.01);
  }

  swap() {
    this.echo = this.makeEcho();
    const at = soon(this.ctx);
    this.out.gain.setTargetAtTime(1, at, 0.01);
  }
}
