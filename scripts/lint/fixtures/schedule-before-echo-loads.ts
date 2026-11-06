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

  derived(at = soon(this.ctx)) {
    const end = at + 0.04;
    this.echo = this.makeEcho();
    this.out.gain.linearRampToValueAtTime(0, end);
  }

  keyed(at = soon(this.ctx)) {
    this.out.gain.setTargetAtTime(0, at, 0.01);
    this.echo = this.makeEcho();
    this.note({ at: 0 }, this.echo);
  }

  note(o: { at: number }, e: ConvolverNode) {
    return o.at + e.channelCount;
  }

  built(at = soon(this.ctx)) {
    this.echo = new ConvolverNode(this.ctx);
    this.out.gain.setTargetAtTime(0, at, 0.01);
  }

  later(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    const end = at + 0.04;
    this.out.gain.linearRampToValueAtTime(0, end);
  }

  nested(at = soon(this.ctx)) {
    const shadow = (at: number) => this.out.gain.setValueAtTime(1, at);
    this.fade(at, this.makeEcho());
    shadow(2);
  }

  fade(at: number, e: ConvolverNode) {
    this.out.gain.setTargetAtTime(0, at + e.channelCount, 0.01);
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
