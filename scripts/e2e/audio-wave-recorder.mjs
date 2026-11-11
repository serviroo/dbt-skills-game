registerProcessor('e2e-wave', class extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.from = Infinity;
    const configure = (data) => {
      this.from = data.from;
      this.left = new Float32Array(data.length);
      this.right = new Float32Array(data.length);
    };
    if (options.processorOptions) configure(options.processorOptions);
    this.port.onmessage = ({ data }) => configure(data);
  }

  process(inputs, outputs) {
    const channels = inputs[0];
    if (!this.left) return true;
    const end = this.from + this.left.length;
    const length = outputs[0][0].length;
    for (let i = 0; i < length; i++) {
      const frame = currentFrame + i;
      if (frame < this.from || frame >= end) continue;
      const at = frame - this.from;
      this.left[at] = channels[0]?.[i] ?? 0;
      this.right[at] = (channels[1] ?? channels[0])?.[i] ?? 0;
    }
    if (currentFrame + length >= end) {
      this.port.postMessage({ left: this.left, right: this.right }, [this.left.buffer, this.right.buffer]);
      this.left = null;
      this.right = null;
    }
    return true;
  }
});
