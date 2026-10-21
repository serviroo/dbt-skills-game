// QA sheet: the icons at 60, 120 and 180 px on a dark and a light Home Screen, masked like iOS, next to plain neighbour tiles.
// node scripts/icon-sheet.mjs <iconDir> <out.png>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const [dir, out] = process.argv.slice(2);
const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(dir, f)).toString('base64');
const touch = b64('icons/apple-touch-icon-180.png');
const mask = b64('icons/icon-maskable-512.png');
const big = b64('icons/icon-512.png');
const fav = b64('icons/favicon-32.png');
const neighbours = ['#34c759', '#0a84ff', '#ff9f0a', '#ffffff', '#ff375f'];
const row = (bg, fg, label) => `
  <section style="background:${bg};color:${fg}">
    <h2>${label}</h2>
    <div class="row">
      ${[60, 120, 180].map((s) => `<figure><img src="${touch}" style="width:${s}px;height:${s}px;border-radius:${s * 0.2237}px"><figcaption>System · ${s}px</figcaption></figure>`).join('')}
      <div class="grid">${neighbours.map((c, i) => (i === 2 ? `<figure><img src="${touch}" style="width:60px;height:60px;border-radius:13.4px"><figcaption>System</figcaption></figure>` : '') + `<figure><div style="width:60px;height:60px;border-radius:13.4px;background:${c};box-shadow:inset 0 0 0 ${c === '#ffffff' ? 1 : 0}px #ccc"></div><figcaption>App</figcaption></figure>`).join('')}</div>
      <figure><img src="${mask}" style="width:120px;height:120px;border-radius:50%"><figcaption>maskable · circle</figcaption></figure>
      <figure><img src="${fav}" style="width:32px;height:32px"><figcaption>favicon 32</figcaption></figure>
    </div>
  </section>`;
const html = `<!doctype html><html><head><style>
  body{margin:0;font-family:system-ui,sans-serif}
  section{padding:18px 24px 22px}
  h2{margin:0 0 14px;font:600 13px system-ui;opacity:.7;letter-spacing:.04em}
  .row{display:flex;gap:28px;align-items:flex-end}
  figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px}
  figcaption{font:500 11px system-ui;opacity:.85}
  .grid{display:grid;grid-template-columns:repeat(3,60px);gap:18px 20px}
  img{display:block}
</style></head><body>
  ${row('linear-gradient(160deg,#1b2433,#0b0f17)', '#f2f2f7', 'DARK HOME SCREEN')}
  ${row('linear-gradient(160deg,#e9eef6,#cfd8e6)', '#1c1c1e', 'LIGHT HOME SCREEN')}
  <section style="background:#000;color:#ccc"><h2>512 SOURCE</h2><div class="row"><img src="${big}" style="width:512px;height:512px"><img src="${mask}" style="width:512px;height:512px"></div></section>
</body></html>`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 400 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
