declare function soon(ctx: BaseAudioContext): number;

export class SharedTimes {
  sharedFreshConsts(ctx: BaseAudioContext, gain: GainNode, at = soon(ctx)) {
    ctx.createConvolver();
    at = soon(ctx);
    const c0 = Math.max(at, at);
    const c1 = Math.max(c0, c0);
    const c2 = Math.max(c1, c1);
    const c3 = Math.max(c2, c2);
    const c4 = Math.max(c3, c3);
    const c5 = Math.max(c4, c4);
    const c6 = Math.max(c5, c5);
    const c7 = Math.max(c6, c6);
    const c8 = Math.max(c7, c7);
    const c9 = Math.max(c8, c8);
    const c10 = Math.max(c9, c9);
    const c11 = Math.max(c10, c10);
    const c12 = Math.max(c11, c11);
    const c13 = Math.max(c12, c12);
    gain.gain.setValueAtTime(0, c13);
  }

  sharedFixedNumbers(ctx: BaseAudioContext, gain: GainNode, at = soon(ctx)) {
    const n0 = 0.02;
    const n1 = n0 / 2 + n0 / 2;
    const n2 = n1 / 2 + n1 / 2;
    const n3 = n2 / 2 + n2 / 2;
    const n4 = n3 / 2 + n3 / 2;
    const n5 = n4 / 2 + n4 / 2;
    const n6 = n5 / 2 + n5 / 2;
    const n7 = n6 / 2 + n6 / 2;
    const n8 = n7 / 2 + n7 / 2;
    const n9 = n8 / 2 + n8 / 2;
    const n10 = n9 / 2 + n9 / 2;
    const n11 = n10 / 2 + n10 / 2;
    const n12 = n11 / 2 + n11 / 2;
    const n13 = n12 / 2 + n12 / 2;
    const n14 = n13 / 2 + n13 / 2;
    const n15 = n14 / 2 + n14 / 2;
    const n16 = n15 / 2 + n15 / 2;
    const n17 = n16 / 2 + n16 / 2;
    const n18 = n17 / 2 + n17 / 2;
    const n19 = n18 / 2 + n18 / 2;
    const n20 = n19 / 2 + n19 / 2;
    const n21 = n20 / 2 + n20 / 2;
    const n22 = n21 / 2 + n21 / 2;
    const n23 = n22 / 2 + n22 / 2;
    const n24 = n23 / 2 + n23 / 2;
    ctx.createConvolver();
    at = soon(ctx) + n24;
    gain.gain.setValueAtTime(0, at);
  }
}
