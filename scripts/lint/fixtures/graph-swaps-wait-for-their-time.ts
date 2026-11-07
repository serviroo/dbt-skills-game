declare function soon(ctx: BaseAudioContext): number;

export class EchoGraph {
  ctx = new AudioContext();
  echo = this.makeEcho();
  out = this.ctx.createGain();

  makeEcho(at = 0) {
    const input = this.ctx.createGain();
    input.gain.value = 0;
    input.gain.setValueAtTime(1, at);
    return input;
  }

  dropEcho(echo: GainNode) {
    echo.disconnect();
  }

  quiet(on: boolean, sec: number, at = soon(this.ctx)) {
    if (on) this.out.gain.linearRampToValueAtTime(0, at + sec);
    const old = this.echo;
    this.echo = this.makeEcho();
    this.dropEcho(old);
  }

  disconnectEarly(at: number) {
    this.out.gain.setValueAtTime(0, at);
    this.out.disconnect();
  }

  disconnectInLoop(at: number) {
    this.out.gain.setValueAtTime(0, at);
    [this.out].forEach((out) => out.disconnect());
  }

  disconnectOnWallClock(at = soon(this.ctx)) {
    setTimeout(() => this.out.disconnect(), at * 1000);
  }

  replaceOnTime(at: number) {
    const old = this.echo;
    this.echo = this.makeEcho(at);
    const silent = this.ctx.createConstantSource();
    silent.onended = () => {
      silent.disconnect();
      this.dropEcho(old);
    };
    silent.start(at);
    silent.stop(at + 0.1);
  }
}

export function replaceEarly(when = soon(new AudioContext())) {
  const out = new AudioContext().createGain();
  out.disconnect();
  return when;
}

export function disconnectEarly(t: number, out: GainNode) {
  out.gain.setTargetAtTime(0, t, 0.1);
  out.disconnect();
}

export function disconnectInCallback(when: number, out: GainNode) {
  const stop = () => out.gain.setValueAtTime(0, when);
  out.disconnect();
  return stop;
}

export function disconnectOnTime(t: number, out: GainNode, clock: ConstantSourceNode) {
  clock.start(t);
  clock.onended = () => out.disconnect();
}

export function disconnectUntimed(at: number, out: GainNode) {
  out.disconnect();
  return at;
}

export function replaceInputEarly(ctx: AudioContext, sends: GainNode[], at = soon(ctx)) {
  const make = () => {
    const c = ctx.createConvolver();
    const input = ctx.createGain();
    input.gain.value = 1;
    const out = ctx.createGain();
    for (const send of sends) send.connect(input);
    input.connect(c).connect(out);
    return input;
  };
  return make();
}

export function replaceInputOnTime(ctx: AudioContext, sends: GainNode[], at: number) {
  const make = () => {
    const c = ctx.createConvolver();
    const input = ctx.createGain();
    input.gain.value = 0;
    input.gain.setValueAtTime(0, at);
    input.gain.linearRampToValueAtTime(1, at + 0.015);
    const out = ctx.createGain();
    for (const send of sends) send.connect(input);
    input.connect(c).connect(out);
    return input;
  };
  return make();
}

function makeInput(ctx: AudioContext, send: GainNode, start: number) {
  const input = ctx.createGain();
  send.connect(input);
  return input;
}

export function replaceInputThroughHelper(ctx: AudioContext, send: GainNode, at = soon(ctx)) {
  return makeInput(ctx, send, at);
}

export function replaceInputAtTheWrongTime(ctx: AudioContext, send: GainNode, at = soon(ctx)) {
  const input = ctx.createGain();
  input.gain.value = 0;
  input.gain.setValueAtTime(1, 0);
  send.connect(input);
  return { input, at };
}

export function connectNewSource(ctx: AudioContext, at: number) {
  const input = ctx.createGain();
  const source = ctx.createOscillator();
  source.connect(input);
  source.start(at);
  return input;
}

export function connectUntimedInput(ctx: AudioContext, send: GainNode) {
  const input = ctx.createGain();
  send.connect(input);
  return input;
}

export function replaceInputWithoutOpening(ctx: AudioContext, send: GainNode, at = soon(ctx)) {
  const input = ctx.createGain();
  input.gain.value = 0;
  send.connect(input);
  return { input, at };
}

export function replaceInputWithoutClosing(ctx: AudioContext, send: GainNode, at: number) {
  const input = ctx.createGain();
  input.gain.value = 1;
  input.gain.setValueAtTime(0, at);
  input.gain.linearRampToValueAtTime(1, at + 0.015);
  send.connect(input);
  return input;
}

const sharedSend = new AudioContext().createGain();

export function replaceInputFromSharedSend(ctx: AudioContext, at = soon(ctx)) {
  const input = ctx.createGain();
  sharedSend.connect(input);
  return { input, at };
}

export function replaceConvolverEarly(ctx: AudioContext, send: GainNode, when = soon(ctx)) {
  const convolver = ctx.createConvolver();
  send.connect(convolver);
  return { convolver, when };
}

export function replaceConstructedConvolverEarly(ctx: AudioContext, send: GainNode, when = soon(ctx)) {
  const convolver = new ConvolverNode(ctx);
  send.connect(convolver);
  return { convolver, when };
}

export function replaceThroughUnscheduledGain(ctx: AudioContext, send: GainNode, when = soon(ctx)) {
  const convolver = ctx.createConvolver();
  const input = ctx.createGain();
  send.connect(input).connect(convolver);
  return { convolver, when };
}

export function replaceInlineConvolverEarly(ctx: AudioContext, send: GainNode, when = soon(ctx)) {
  send.connect(new ConvolverNode(ctx));
  return when;
}

function makeConvolver(ctx: AudioContext, send: GainNode, when: number) {
  const convolver = ctx.createConvolver();
  send.connect(convolver);
  return { convolver, when };
}

export function replaceConvolverThroughHelper(ctx: AudioContext, send: GainNode, when = soon(ctx)) {
  return makeConvolver(ctx, send, when);
}

export function replaceWithLocalAudioTime(ctx: AudioContext, send: GainNode) {
  const when = soon(ctx);
  const convolver = ctx.createConvolver();
  send.connect(convolver);
  return { convolver, when };
}

export function connectAtUntimedIndex(ctx: AudioContext, send: GainNode, at: number) {
  const convolver = ctx.createConvolver();
  send.connect(convolver, at);
  return convolver;
}

export function connectUntimedGain(ctx: AudioContext, send: GainNode, at: number) {
  const input = ctx.createGain();
  send.connect(input, at);
  return input;
}

export class HelperGraph {
  ctx = new AudioContext();
  send = this.ctx.createGain();

  replace(when = soon(this.ctx)) {
    return this.build(when);
  }

  build(when: number) {
    const convolver = this.ctx.createConvolver();
    this.send.connect(convolver);
    return { convolver, when };
  }
}

export function dropAfterLocalTime(ctx: AudioContext, out: GainNode) {
  const when = soon(ctx);
  out.gain.setValueAtTime(0, when);
  out.disconnect();
}

export function dropInTimedHandler(ctx: AudioContext, out: GainNode) {
  const when = soon(ctx);
  const silent = ctx.createConstantSource();
  silent.onended = () => out.disconnect();
  silent.stop(when);
}

function aliasedOpening(ctx: AudioContext, send: GainNode, at: number) {
  const openAt = at;
  const input = ctx.createGain();
  input.gain.value = 0;
  input.gain.setValueAtTime(1, openAt);
  send.connect(input);
  return input;
}

export function replaceAtAliasedTime(ctx: AudioContext, send: GainNode) {
  return aliasedOpening(ctx, send, soon(ctx));
}

export function replaceWithReopenedInput(ctx: AudioContext, send: GainNode, at = soon(ctx)) {
  const input = ctx.createGain();
  input.gain.value = 0;
  input.gain.value = 1;
  input.gain.setValueAtTime(1, at);
  send.connect(input);
  return input;
}

export function replaceWithClosedInput(ctx: AudioContext, send: GainNode, at = soon(ctx)) {
  const input = ctx.createGain();
  input.gain.value = 1;
  input.gain.value = 0;
  input.gain.setValueAtTime(1, at);
  send.connect(input);
  return input;
}
