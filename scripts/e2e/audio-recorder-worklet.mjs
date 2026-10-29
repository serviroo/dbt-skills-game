registerProcessor('e2e-recorder', class extends AudioWorkletProcessor {
  // The number of the block being rendered, which the page ramps on the context's own clock. currentFrame can't say it:
  // while the page holds the audio graph, it keeps an older block's number and catches up later.
  static get parameterDescriptors() {
    return [{ name: 'block', defaultValue: -1, minValue: -1, automationRate: 'a-rate' }];
  }
  prev = 0;
  last = -1;
  posted = 0;
  constructor() {
    super();
    // the answer leaves after every block this processor posted, so once it arrives the recording is all there
    this.port.onmessage = () => this.port.postMessage({ last: this.last });
  }
  process([input], outputs, { block }) {
    const n = Math.round(block[0]);
    if (n < 0) return true;
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
    this.last = n;
    // with how many blocks this processor has posted: the page can tell a block that never arrived from one the clock
    // counted (as the context paused or woke) but this processor never ran for
    this.port.postMessage([[n, peak, ss, step, ++this.posted]]);
    return true;
  }
});
