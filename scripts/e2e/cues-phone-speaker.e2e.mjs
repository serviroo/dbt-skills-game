// Every cue reads through a phone speaker. A phone's small speaker plays little below about 800 Hz, so each cue keeps
// part of its sound between 0.8 and 5 kHz (DESIGN.md, Sound grammar): a low thud or a deep swell carries a knock, an
// upper partial or a breath up there too. Each cue in src/audio/cues.ts is rendered offline through the engine's whole
// output chain, as the game plays it, and the share of its energy in that band is read from its spectrum.

const BAND = [800, 5000];
// at least a tenth of each cue's energy in the band: on a phone it keeps its level within 10 dB
const FLOOR = 0.1;
// silent by design (no voice for AWAKEN); it is checked again here the day it makes a sound
const SILENT = ['awaken_voice'];

export const scenarios = {
  /** every cue keeps at least a tenth of its energy between 0.8 and 5 kHz */
  async 'every-cue-reads-on-a-phone-speaker'({ open, expect }) {
    const { ctx, page, errors } = await open({}, '?lab=audio&mute');
    await page.waitForFunction(() => window.__lab === true, null, { timeout: 30000 });
    const cues = await page.evaluate(async ([lo, hi]) => {
      const { CUES } = await import('/src/audio/cues.ts');
      const { renderOffline, cueLength } = await import('/src/audio/engine.ts');
      const fft = (re, im) => {
        const n = re.length;
        for (let i = 1, j = 0; i < n; i++) {
          let bit = n >> 1;
          for (; j & bit; bit >>= 1) j ^= bit;
          j ^= bit;
          if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
          }
        }
        for (let len = 2; len <= n; len <<= 1) {
          const a = (-2 * Math.PI) / len;
          for (let i = 0; i < n; i += len) {
            for (let k = 0; k < len / 2; k++) {
              const c = Math.cos(a * k), s = Math.sin(a * k);
              const p = i + k, q = p + len / 2;
              const vr = re[q] * c - im[q] * s, vi = re[q] * s + im[q] * c;
              re[q] = re[p] - vr;
              im[q] = im[p] - vi;
              re[p] += vr;
              im[p] += vi;
            }
          }
        }
      };
      const out = {};
      for (const cue of Object.keys(CUES)) {
        const buf = await renderOffline([{ t: 0.02, cue }], cueLength(cue) + 0.3, 48000);
        let n = 1;
        while (n < buf.length) n <<= 1;
        let band = 0, all = 0, peak = 0;
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
          const d = buf.getChannelData(ch);
          for (const x of d) peak = Math.max(peak, Math.abs(x));
          const re = new Float64Array(n), im = new Float64Array(n);
          re.set(d);
          fft(re, im);
          for (let k = 1; k < n / 2; k++) {
            const p = re[k] * re[k] + im[k] * im[k];
            const f = (k * buf.sampleRate) / n;
            all += p;
            if (f >= lo && f <= hi) band += p;
          }
        }
        out[cue] = { share: all ? band / all : 0, peak };
      }
      return out;
    }, BAND);
    const names = Object.keys(cues);
    expect(names.length > 20, `only ${names.length} cues rendered`);
    for (const c of SILENT) expect(cues[c] && cues[c].peak < 2 ** -15, `${c} makes a sound now (peak ${cues[c]?.peak}): take it off SILENT so the floor covers it`);
    const thin = names.filter((c) => !SILENT.includes(c) && !(cues[c].share >= FLOOR));
    expect(!thin.length, 'cues with too little between 0.8 and 5 kHz to read on a phone speaker: ' + thin.map((c) => `${c} ${(cues[c].share * 100).toFixed(1)} %`).join(', '));
    expect(!errors.length, errors.join('\n'));
    await ctx.close();
    return Object.fromEntries(names.map((c) => [c, +(cues[c].share * 100).toFixed(1)]));
  },
};
