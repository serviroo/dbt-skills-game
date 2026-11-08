/** 16-bit PCM WAV (or 32-bit float with { float: true }). */
export function bufferToWav(buf: AudioBuffer, o: { float?: boolean } = {}): ArrayBuffer {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const bps = o.float ? 4 : 2;
  const data = n * ch * bps;
  const ab = new ArrayBuffer(44 + data);
  const dv = new DataView(ab);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, o.float ? 3 : 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, buf.sampleRate, true);
  dv.setUint32(28, buf.sampleRate * ch * bps, true);
  dv.setUint16(32, ch * bps, true);
  dv.setUint16(34, bps * 8, true);
  str(36, 'data');
  dv.setUint32(40, data, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let off = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = chans[c][i];
      if (o.float) dv.setFloat32(off, x, true);
      else dv.setInt16(off, Math.max(-32768, Math.min(32767, Math.round(x * 32767))), true);
      off += bps;
    }
  }
  return ab;
}

export function toBase64(ab: ArrayBuffer) {
  const u = new Uint8Array(ab);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, Array.from(u.subarray(i, i + 0x8000)));
  }
  return btoa(s);
}
