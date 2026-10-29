// QA: the install hint over a live lab backdrop. node scripts/pwa-hint-shot.mjs <outDir> [lab=gate] [seekSeconds=6]
import { chromium } from 'playwright';
import { glArgs, checkRenderer } from './gl.mjs';
import fs from 'node:fs';
const [outDir, lab = 'gate', seek = '6'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const base = process.env.BASE ?? 'http://127.0.0.1:5173/';
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: glArgs() });
try {
  for (const [w, h, dsf] of [[375, 800, Number(process.env.DSF ?? 1)], [1440, 900, 1]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
    console.log('renderer:', await checkRenderer(page));
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await page.goto(`${base}?lab=${lab}${process.env.EXTRA ?? ""}`);
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 30000 });
    await page.evaluate((t) => (window.__seek ? window.__seek(t) : null), Number(seek));
    await page.waitForTimeout(1500);
    if (process.env.PAUSED) await page.evaluate(() => { window.__stage.paused = true; });
    await page.evaluate(() => { window.__hint = import('/src/pwa/install-hint.ts').then((m) => m.maybeShowInstallHint({ force: true })); });
    // opening frames: the stepped open and the content wipe
    for (const ms of [60, 140, 400]) {
      await page.waitForTimeout(ms === 60 ? 60 : ms - (ms === 140 ? 60 : 140));
      await page.screenshot({ path: `${outDir}/hint-${w}-open${ms}.png` });
    }
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${outDir}/hint-${w}.png` });
    await page.click('.pwa-hint .sw-btn');
    const r = await page.evaluate(() => window.__hint);
    await page.waitForTimeout(600);
    const left = await page.evaluate(() => ({ hint: !!document.querySelector('.pwa-hint'), stored: localStorage.getItem('dbt.install-hint.v1') }));
    await page.screenshot({ path: `${outDir}/hint-${w}-after.png` });
    console.log(`${w}x${h}`, JSON.stringify({ resolved: r, ...left }), errs.length ? 'errors: ' + errs.slice(0, 5).join(' | ') : 'no errors');
    await page.close();
  }
} finally {
  await browser.close();
}
