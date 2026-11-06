export function slowEchoLoadsFromPress(ctx, ms) {
  return ctx.addInitScript((ms) => {
    const buffer = Object.getOwnPropertyDescriptor(ConvolverNode.prototype, 'buffer');
    Object.defineProperty(ConvolverNode.prototype, 'buffer', {
      ...buffer,
      set(b) {
        const end = performance.now() + ms;
        if (window.__pressAt !== undefined) window.__echoStalls = (window.__echoStalls ?? 0) + 1;
      while (window.__pressAt !== undefined && performance.now() < end);
        buffer.set.call(this, b);
      },
    });
  }, ms);
}
