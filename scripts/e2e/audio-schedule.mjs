export function tapAudioSchedule(record, after) {
  const undo = [];
  const wrap = (prototype, method, timeArg) => {
    const original = prototype[method];
    const own = Object.getOwnPropertyDescriptor(prototype, method);
    prototype[method] = function (...args) {
      record(this, method, args, args[timeArg] ?? 0);
      const result = original.apply(this, args);
      after?.(this, method);
      return result;
    };
    undo.push(() => {
      if (own) Object.defineProperty(prototype, method, own);
      else delete prototype[method];
    });
  };
  for (const [method, timeArg] of [
    ['setValueAtTime', 1], ['linearRampToValueAtTime', 1], ['exponentialRampToValueAtTime', 1],
    ['setTargetAtTime', 1], ['setValueCurveAtTime', 1], ['cancelScheduledValues', 0], ['cancelAndHoldAtTime', 0],
  ]) wrap(AudioParam.prototype, method, timeArg);
  for (const prototype of [AudioScheduledSourceNode.prototype, AudioBufferSourceNode.prototype]) {
    for (const method of ['start', 'stop']) {
      if (Object.hasOwn(prototype, method)) wrap(prototype, method, 0);
    }
  }
  return () => undo.reverse().forEach((restore) => restore());
}

export function recordAudioSchedule(context) {
  const ids = new WeakMap();
  const calls = [];
  const undo = [];
  let next = 0;
  for (const method of Object.getOwnPropertyNames(BaseAudioContext.prototype).filter((m) => m.startsWith('create'))) {
    const original = context[method];
    context[method] = function (...args) {
      const node = original.apply(this, args);
      if (!(node instanceof AudioNode)) return node;
      const id = `${next++}:${node.constructor.name}`;
      ids.set(node, id);
      for (let p = Object.getPrototypeOf(node); p !== AudioNode.prototype; p = Object.getPrototypeOf(p)) {
        for (const key of Object.getOwnPropertyNames(p)) {
          if (Object.getOwnPropertyDescriptor(p, key).get && node[key] instanceof AudioParam) {
            ids.set(node[key], `${id}.${key}`);
          }
        }
      }
      return node;
    };
    undo.push(() => delete context[method]);
  }
  undo.push(tapAudioSchedule((receiver, method, args, time) => {
    if (!ids.has(receiver)) return;
    const values = args.map((v) => ArrayBuffer.isView(v) ? Array.from(v) : v);
    calls.push({ target: ids.get(receiver), method, values, time });
  }));
  return { calls, stop: () => undo.reverse().forEach((restore) => restore()) };
}
