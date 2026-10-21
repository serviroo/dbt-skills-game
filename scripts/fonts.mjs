// Subset the two self-hosted families and write WOFF2 into public/fonts.
// Her own writing (Story Room, diary, lists) needs real glyphs for any Latin text she types: Basic Latin,
// Latin-1 Supplement (NBSP, á ñ ß ¿ « »), Latin Extended-A (œ ł ő ğ ...), General Punctuation, plus the symbols
// the UI already used.
// Sources: the OFL variable fonts from github.com/google/fonts (ofl/jost, ofl/bodonimoda), saved as
//   <FONT_SRC>/jost.ttf, jost-italic.ttf, bodoni.ttf   (FONT_SRC defaults to /tmp/fonts)
import subsetFont from 'subset-font';
import fs from 'node:fs';
import os from 'node:os';

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i)).join('');
const text =
  range(0x20, 0x7e) + // Basic Latin
  range(0xa0, 0xff) + // Latin-1 Supplement
  range(0x100, 0x17f) + // Latin Extended-A
  range(0x2000, 0x206f) + // General Punctuation
  '★☆✦✧♡◆◇○●▲▼™©®°±≈≤≥½¼¾€→←↑↓×';
const dir = [process.env.FONT_SRC, '/tmp/fonts', `${os.homedir()}/.cache/agent-tmp/story-fonts/src`].find((d) => d && fs.existsSync(`${d}/jost.ttf`));
if (!dir) throw new Error('No source fonts. Put jost.ttf, jost-italic.ttf and bodoni.ttf from google/fonts in FONT_SRC.');
const jobs = [
  [`${dir}/jost.ttf`, 'public/fonts/jost.woff2'],
  [`${dir}/jost-italic.ttf`, 'public/fonts/jost-italic.woff2'],
  [`${dir}/bodoni.ttf`, 'public/fonts/bodoni-moda.woff2'],
];
for (const [src, out] of jobs) {
  const before = fs.existsSync(out) ? fs.statSync(out).size : 0;
  const buf = await subsetFont(fs.readFileSync(src), text, { targetFormat: 'woff2', preserveAxes: true });
  fs.writeFileSync(out, buf);
  console.log(`${out} ${before} -> ${buf.length}`);
}
