function holdFences(busy) {
  const P = WebGL2RenderingContext.prototype;
  const make = P.fenceSync;
  const get = P.getSyncParameter;
  const made = new WeakMap();
  let count = 0;
  P.fenceSync = function (...args) {
    const fence = make.apply(this, args);
    if (this.canvas.closest?.('.dq-scene')) made.set(fence, { n: count++, at: performance.now() });
    return fence;
  };
  P.getSyncParameter = function (fence, pname) {
    const seen = made.get(fence);
    if (seen && pname === this.SYNC_STATUS && busy(seen)) return this.UNSIGNALED;
    return get.call(this, fence, pname);
  };
}

export function holdSceneFences(ctx, busy) {
  return ctx.addInitScript(`(${holdFences})(${busy})`);
}
