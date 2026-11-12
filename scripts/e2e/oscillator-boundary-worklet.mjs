registerProcessor('oscillator-boundary', class extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.from = options.processorOptions.from;
    this.length = options.processorOptions.length;
    this.data = Array.from({ length: 7 }, () => new Float32Array(this.length));
  }
  process(inputs, outputs) {
    const channels = inputs[0];
    const size = outputs[0][0].length;
    for (let i = 0; i < size; i++) {
      const at = currentFrame + i - this.from;
      if (at < 0 || at >= this.length) continue;
      for (let ch = 0; ch < this.data.length; ch++) this.data[ch][at] = channels[ch]?.[i] ?? 0;
    }
    if (currentFrame + size >= this.from + this.length) {
      this.port.postMessage(this.data, this.data.map((d) => d.buffer));
      return false;
    }
    return true;
  }
});
