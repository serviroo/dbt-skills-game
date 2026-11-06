export function slowEchoLoadsFromPress(ctx, ms) {
  return ctx.addInitScript((ms) => {
    const buffer = Object.getOwnPropertyDescriptor(ConvolverNode.prototype, 'buffer');
    Object.defineProperty(ConvolverNode.prototype, 'buffer', {
      ...buffer,
      set(b) {
        if (window.__pressAt !== undefined) {
          window.__echoStalls = (window.__echoStalls ?? 0) + 1;
          const end = performance.now() + ms;
          while (performance.now() < end);
        }
        buffer.set.call(this, b);
      },
    });
  }, ms);
}
