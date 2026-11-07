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

  peer = { reset() {} };

  assigned() {
    let at = 0;
    at = soon(this.ctx);
    this.echo = this.makeEcho();
    this.out.gain.setTargetAtTime(0, at, 0.01);
  }

  refreshedAfter(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    at = soon(this.ctx);
    this.out.gain.setTargetAtTime(0, at, 0.01);
  }

  refreshedDerivedAfter(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    at = soon(this.ctx);
    const end = at + 0.04;
    this.out.gain.linearRampToValueAtTime(0, end);
  }

  refreshedSoonOffset(at = soon(this.ctx)) {
    const lead = 0.02;
    this.echo = this.makeEcho();
    at = soon(this.ctx) + lead;
    this.out.gain.setValueAtTime(0, at);
    at = lead + soon(this.ctx);
    this.out.gain.setValueAtTime(0, at);
  }

  refreshedClockAfter(at = soon(this.ctx)) {
    const lead = 0.02;
    this.echo = this.makeEcho();
    at = this.ctx.currentTime + lead;
    this.out.gain.setTargetAtTime(0, at, 0.01);
  }

  refreshedTwiceDerivedAfter(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    at = soon(this.ctx);
    const middle = at + 0.02;
    const end = middle + 0.02;
    this.out.gain.linearRampToValueAtTime(0, end);
  }

  reassignedDerivedAfter(at = soon(this.ctx)) {
    let end = at + 0.04;
    this.echo = this.makeEcho();
    const fresh = soon(this.ctx);
    end = fresh + 0.04;
    this.out.gain.linearRampToValueAtTime(0, end);
  }

  assignedAfterCall(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    let end = 0;
    this.out.gain.linearRampToValueAtTime(0, end);
    end = at + 0.04;
    return end;
  }

  keepsOldDerivedTime(at = soon(this.ctx)) {
    const old = at + 0.02;
    this.echo = this.makeEcho();
    at = soon(this.ctx);
    const end = old + 0.02;
    this.out.gain.linearRampToValueAtTime(0, end);
  }

  conditionalRefresh(refresh: boolean, at = soon(this.ctx)) {
    let end = at + 0.04;
    this.echo = this.makeEcho();
    if (refresh) end = soon(this.ctx);
    this.out.gain.linearRampToValueAtTime(0, end);
  }

  rightHandSideKeepsOldTime(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    const fresh = soon(this.ctx);
    const end = at + ((at = fresh), 0.04);
    this.out.gain.linearRampToValueAtTime(0, end);
  }

  keepsOldClockTime() {
    const lead = 0.02;
    let at = 0;
    at = this.ctx.currentTime + lead;
    this.echo = this.makeEcho();
    this.out.gain.setTargetAtTime(0, at, 0.01);
  }

  timelineTime() {
    const at = Number(document.timeline.currentTime);
    this.echo = this.makeEcho();
    this.note({ at }, this.echo);
  }

  conditionalAssignmentsFreshValueNotProven(refresh: boolean, at = soon(this.ctx)) {
    let end = at;
    this.echo = this.makeEcho();
    const fresh = soon(this.ctx);
    refresh ? end = soon(this.ctx) : end = 0;
    this.out.gain.setValueAtTime(0, end);
    refresh && (end = soon(this.ctx));
    this.out.gain.setValueAtTime(0, end);
    refresh || (end = soon(this.ctx));
    this.out.gain.setValueAtTime(0, end);
    const option: number | null = soon(this.ctx);
    option ?? (end = soon(this.ctx));
    this.out.gain.setValueAtTime(0, end);
    switch (refresh) {
      case true: end = soon(this.ctx);
    }
    this.out.gain.setValueAtTime(0, end);
    for (let i = 0; i < 1; i++) end = soon(this.ctx);
    this.out.gain.setValueAtTime(0, end);
    for (end = soon(this.ctx); refresh; ) this.out.gain.setValueAtTime(0, end);
    for (; refresh; end = soon(this.ctx)) this.out.gain.setValueAtTime(0, end);
    for (const item of [fresh]) end = item;
    this.out.gain.setValueAtTime(0, end);
    for (const key in { fresh }) end = Number(key);
    this.out.gain.setValueAtTime(0, end);
    while (refresh) end = soon(this.ctx);
    this.out.gain.setValueAtTime(0, end);
    do { end = soon(this.ctx); } while (refresh);
    this.out.gain.setValueAtTime(0, end);
    try { end = soon(this.ctx); } catch { end = 0; } finally { end = soon(this.ctx); }
    this.out.gain.setValueAtTime(0, end);
  }

  conditionalStaleTime(refresh: boolean, at = soon(this.ctx)) {
    let end = 0;
    this.echo = this.makeEcho();
    if (refresh) end = at;
    this.out.gain.setValueAtTime(0, end);
  }

  freshAfterConditional(refresh: boolean, at = soon(this.ctx)) {
    let end = at;
    this.echo = this.makeEcho();
    if (refresh) end = at;
    end = soon(this.ctx);
    this.out.gain.setValueAtTime(0, end);
  }

  nestedAssignmentFreshValueNotProven(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    const fresh = soon(this.ctx);
    const end = (at = fresh) + at + 0.04;
    this.out.gain.setValueAtTime(0, end);
  }

  argumentKeepsOldTime(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    const fresh = soon(this.ctx);
    this.fade(at, (at = fresh, this.echo));
  }

  argumentAssignmentFreshValueNotProven(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    const fresh = soon(this.ctx);
    this.fade(at = fresh, this.echo);
  }

  sequenceResultFreshValueNotProven(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    const fresh = soon(this.ctx);
    const end = (at, fresh);
    this.out.gain.setValueAtTime(0, end);
  }

  declarationKeepsOldTime() {
    var at = soon(this.ctx);
    this.echo = this.makeEcho();
    var at;
    this.out.gain.setValueAtTime(0, at);
  }

  blockLocal(at = soon(this.ctx)) {
    this.out.gain.setTargetAtTime(0, at, 0.01);
    this.echo = this.makeEcho();
    {
      const at = soon(this.ctx);
      this.out.gain.setTargetAtTime(1, at, 0.01);
    }
  }

  unrelated(at = soon(this.ctx)) {
    this.peer.reset();
    this.out.gain.setTargetAtTime(0, at, 0.01);
  }

  logged(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    console.debug(at);
  }

  optionalCallRefreshMayNotRun(callback: ((value: number) => void) | undefined, at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    callback?.(at = soon(this.ctx));
    this.out.gain.setValueAtTime(0, at);
  }

  optionalMemberRefresh(options: Record<number, unknown> | undefined, at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    options?.[at = soon(this.ctx)];
    this.out.gain.setValueAtTime(0, at);
  }

  destructuringDefaults(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    ({ at = soon(this.ctx) } = { at });
    this.out.gain.setValueAtTime(0, at);
    [at = soon(this.ctx)] = [at];
    this.out.gain.setValueAtTime(0, at);
  }

  nestedCallback(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    setTimeout(() => this.out.gain.setValueAtTime(0, at), 10);
    setTimeout((value = at) => this.out.gain.setValueAtTime(0, value), 10);
  }

  namedCallback(at = soon(this.ctx)) {
    const ramp = (value = at) => this.out.gain.setValueAtTime(0, value);
    this.echo = this.makeEcho();
    setTimeout(ramp, 10);
    ramp();
  }

  calledInline(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    (() => this.out.gain.setValueAtTime(0, at))();
  }

  nestedAndCompoundFreshValueNotProven(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    const fresh = soon(this.ctx);
    const end = at = fresh;
    this.out.gain.setValueAtTime(end, at);
    at += fresh;
    this.out.gain.setValueAtTime(0, at);
    at++;
    this.out.gain.setValueAtTime(0, at);
  }

  sequenceAssignmentFreshValueNotProven(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    (at = soon(this.ctx), 0);
    this.out.gain.setValueAtTime(0, at);
  }

  varRedeclarationFreshValueNotProven() {
    var at = soon(this.ctx);
    this.echo = this.makeEcho();
    var at = soon(this.ctx);
    this.out.gain.setValueAtTime(0, at);
  }

  destructuringAdds(at = soon(this.ctx)) {
    let end = 0;
    let other = 0;
    this.echo = this.makeEcho();
    ({ end } = { end: at });
    this.out.gain.setValueAtTime(0, end);
    [other = at] = [];
    this.out.gain.setValueAtTime(0, other);
    let loop = 0;
    for (loop of [at]) {}
    this.out.gain.setValueAtTime(0, loop);
  }

  callbackObjectDataMistakenForCall(at = soon(this.ctx)) {
    const ramp = () => this.out.gain.setValueAtTime(0, at);
    this.echo = this.makeEcho();
    setTimeout(() => 0, 10, { ramp: 0 });
    setTimeout(() => 0, 10, { ramp });
  }

  plainBlockRefresh(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    {
      at = soon(this.ctx);
    }
    setTimeout(() => this.out.gain.setValueAtTime(0, at), 10);
  }

  refreshedCaptureMistakenForStaleCallback(at = soon(this.ctx)) {
    const ramp = () => this.out.gain.setValueAtTime(0, at);
    this.echo = this.makeEcho();
    at = soon(this.ctx);
    setTimeout(ramp, 10);
    ramp();
  }

  loopCarriedWrite(at = soon(this.ctx)) {
    let end = 0;
    this.echo = this.makeEcho();
    for (let i = 0; i < 2; i++) {
      this.out.gain.setValueAtTime(0, end);
      end = at;
    }
  }

  callbackAlias(at = soon(this.ctx)) {
    const ramp = () => this.out.gain.setValueAtTime(0, at);
    const alias = ramp;
    this.echo = this.makeEcho();
    setTimeout(alias, 10);
    alias();
  }

  conditionalSoon(refresh: boolean, at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    if (refresh) at = soon(this.ctx);
    this.out.gain.setValueAtTime(0, at);
  }

  nestedSoon(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    const end = at + (at = soon(this.ctx));
    this.out.gain.setValueAtTime(0, end);
  }

  optionalCallSoonMayNotRun(callback: ((value: number) => void) | undefined, at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    callback?.(at = soon(this.ctx));
    this.out.gain.setValueAtTime(0, at);
  }

  optionalReceiverSoon(clock: { soon(): number } | undefined, at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    at = clock?.soon() + 0.01;
    this.out.gain.setValueAtTime(0, at);
  }

  conditionalConst(refresh: boolean, at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    at = soon(this.ctx);
    if (refresh) {
      const end = at + 0.02;
      this.out.gain.setValueAtTime(0, end);
    }
  }

  staleAfterRefresh(at = soon(this.ctx)) {
    const old = at;
    this.echo = this.makeEcho();
    at = soon(this.ctx);
    at = old;
    const end = at + 0.02;
    this.out.gain.setValueAtTime(0, end);
  }

  capturedWriteAfterRefresh(at = soon(this.ctx)) {
    const old = at;
    const restore = () => { at = old; };
    this.echo = this.makeEcho();
    at = soon(this.ctx);
    restore();
    const end = at + 0.02;
    this.out.gain.setValueAtTime(0, end);
  }

  clockWithOldTime(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    at = this.ctx.currentTime + at;
    const end = at + 0.02;
    this.out.gain.setValueAtTime(0, end);
  }

  timelineRefresh(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    at = Number(document.timeline.currentTime);
    const end = at + 0.02;
    this.out.gain.setValueAtTime(0, end);
  }

  plainBlockConst(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    {
      at = soon(this.ctx);
      const end = at + 0.02;
      this.out.gain.setValueAtTime(0, end);
    }
  }

  clockConstAfter(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    at = this.ctx.currentTime;
    const end = at + 0.02;
    this.out.gain.setValueAtTime(0, end);
  }

  snapshotRefresh(at = soon(this.ctx)) {
    const snapshot = { currentTime: at };
    this.echo = this.makeEcho();
    at = snapshot.currentTime;
    this.out.gain.setValueAtTime(0, at);
    const end = at + 0.02;
    this.out.gain.setValueAtTime(0, end);
  }

  timelineAliasRefresh(at = soon(this.ctx)) {
    const timeline = document.timeline;
    this.echo = this.makeEcho();
    at = timeline.currentTime;
    const end = at + 0.02;
    this.out.gain.setValueAtTime(0, end);
  }

  mediaClockRefresh(at = soon(this.ctx)) {
    const media = document.createElement('audio');
    this.echo = this.makeEcho();
    at = media.currentTime;
    const end = at + 0.02;
    this.out.gain.setValueAtTime(0, end);
  }

  safeSiblingCallback(at = soon(this.ctx)) {
    const handlers = { safe: () => 0, stale: () => this.out.gain.setValueAtTime(0, at) };
    const receiver = handlers;
    const alias = receiver.safe;
    this.echo = this.makeEcho();
    handlers.safe();
    receiver.safe();
    alias();
  }

  memberCallback(at = soon(this.ctx)) {
    const handlers = { safe: () => 0, stale: () => this.out.gain.setValueAtTime(0, at) };
    this.echo = this.makeEcho();
    handlers.stale();
    setTimeout(handlers.stale, 10);
  }

  memberCallbackAlias(at = soon(this.ctx)) {
    const handlers = { stale: () => this.out.gain.setValueAtTime(0, at) };
    const receiver = handlers;
    const alias = receiver.stale;
    const callback = alias;
    this.echo = this.makeEcho();
    callback();
    setTimeout(callback, 10);
  }

  unrelatedParameter() {
    function play(ctx: BaseAudioContext, gain: GainNode, value: number, at = soon(ctx)) {
      ctx.createConvolver();
      gain.gain.setValueAtTime(value, 0);
      return at;
    }
    return play;
  }

  refreshedParameter() {
    function play(ctx: BaseAudioContext, gain: GainNode, value: number, at = soon(ctx)) {
      ctx.createConvolver();
      at = soon(ctx);
      gain.gain.setValueAtTime(value, at);
    }
    return play;
  }

  replacedMemberCallback(at = soon(this.ctx)) {
    const handlers = { run: () => this.out.gain.setValueAtTime(0, at) };
    this.echo = this.makeEcho();
    handlers.run = () => 0;
    handlers.run();
  }

  constBeforeRefresh(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    const end = at + 0.02;
    at = soon(this.ctx);
    this.out.gain.setValueAtTime(0, end);
  }

  constBeforeOverwrite(at = soon(this.ctx)) {
    const old = at;
    this.echo = this.makeEcho();
    at = soon(this.ctx);
    const end = at + 0.02;
    at = old;
    this.out.gain.setValueAtTime(0, end);
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

  refreshInsideIf(c: boolean, at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    if (c) {
      at = soon(this.ctx);
      this.out.gain.setValueAtTime(0, at);
      if (c) this.out.gain.setValueAtTime(0, at);
    }
  }

  refreshInsideFor(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    for (let i = 0; i < 2; i++) {
      at = soon(this.ctx);
      this.out.gain.setValueAtTime(0, at);
    }
  }

  refreshInsideTry(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    try {
      at = soon(this.ctx);
      this.out.gain.setValueAtTime(0, at);
    } catch {
      at = soon(this.ctx);
      this.out.gain.setValueAtTime(0, at);
    } finally {
      at = soon(this.ctx);
      this.out.gain.setValueAtTime(0, at);
    }
  }

  refreshedMathBounds(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    at = Math.max(soon(this.ctx), 0.5);
    this.out.gain.setValueAtTime(0, at);
    at = Math.min(soon(this.ctx) + 0.02, soon(this.ctx) + 0.05);
    this.out.gain.setValueAtTime(0, at);
  }

  staleMinBound(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    at = Math.min(0.5, soon(this.ctx) + 0.02);
    this.out.gain.setValueAtTime(0, at);
  }

  conditionalRerefresh(c: boolean, at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    at = soon(this.ctx);
    if (c) at = soon(this.ctx);
    this.out.gain.setValueAtTime(0, at);
  }

  freshCompoundOffset(at = soon(this.ctx)) {
    const offset = 0.02;
    this.echo = this.makeEcho();
    at = soon(this.ctx);
    this.out.gain.setValueAtTime(0, at);
    at += offset;
    this.out.gain.setValueAtTime(0, at);
  }

  refreshFromFreshConst(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    const now = soon(this.ctx);
    at = now + 0.02;
    this.out.gain.setValueAtTime(0, at);
  }

  refreshedWrappers(at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    at = (soon(this.ctx) as number);
    this.out.gain.setValueAtTime(0, at);
    at = (soon(this.ctx) + (0.02 as number))!;
    this.out.gain.setValueAtTime(0, at);
    const now = (Math.max(soon(this.ctx), 0.02) satisfies number)!;
    at = (now as number) + 0.02;
    this.out.gain.setValueAtTime(0, at);
  }

  conditionalStaleAfterFresh(c: boolean, at = soon(this.ctx)) {
    const old = at;
    this.echo = this.makeEcho();
    at = soon(this.ctx);
    if (c) at = old;
    this.out.gain.setValueAtTime(0, at);
  }

  refreshStaysInItsBranch(c: boolean, at = soon(this.ctx)) {
    this.echo = this.makeEcho();
    if (c) {
      at = soon(this.ctx);
      this.out.gain.setValueAtTime(0, at);
    }
    this.out.gain.setValueAtTime(0, at);
  }

  staleCompoundAfterFresh(at = soon(this.ctx)) {
    const old = at;
    this.echo = this.makeEcho();
    at = soon(this.ctx);
    at += old;
    this.out.gain.setValueAtTime(0, at);
  }

  maxWithOldBoundIsOverReported(at = soon(this.ctx)) {
    const old = at;
    this.echo = this.makeEcho();
    at = soon(this.ctx);
    at = Math.max(soon(this.ctx), old);
    this.out.gain.setValueAtTime(0, at);
  }
}
