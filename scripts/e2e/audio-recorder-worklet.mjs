registerProcessor('e2e-recorder', class extends AudioWorkletProcessor {
  prev = 0;
  last = -1;
  constructor() {
    super();
    // the answer leaves after every block this processor posted, so once it arrives the recording is all there
    this.port.onmessage = () => this.port.postMessage({ last: this.last });
  }
  process([input]) {
    const samples = input[0];
    let peak = 0;
    let ss = 0;
    let step = 0;
    for (let i = 0; i < 128; i++) {
      const v = samples ? samples[i] : 0;
      peak = Math.max(peak, Math.abs(v));
      ss += v * v;
      step = Math.max(step, Math.abs(v - this.prev));
      this.prev = v;
    }
    this.last = currentFrame / 128;
    this.port.postMessage([[this.last, peak, ss, step]]);
    return true;
  }
});
