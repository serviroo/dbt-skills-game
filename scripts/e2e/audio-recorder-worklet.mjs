registerProcessor('e2e-recorder', class extends AudioWorkletProcessor {
  prev = 0;
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
    this.port.postMessage([[currentFrame / 128, peak, ss, step]]);
    return true;
  }
});
