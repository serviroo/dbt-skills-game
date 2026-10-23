// Loads every lab and the app from a built dist under its real CSP and lists any policy violations.
// node scripts/pwa-csp-sweep.mjs [--dist=dist] [--seconds=6] [--shots=<dir under the project>] [--port=4179]
// Serves on the first free port from --port. Exits 1 if any page breaks the policy, logs an error, has a request fail
// or never gets ready, or if the browser can't start. (--check, which older callers pass, changes nothing.)
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPreview } from './preview.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v = 'true'] = a.slice(2).split('='); return [k, v]; }));
const dist = path.resolve(root, flags.dist ?? 'dist');
const secs = Number(flags.seconds ?? 6);
const pages = ['', '?lab=character', '?lab=window', '?lab=gate', '?lab=awaken', '?lab=chest', '?lab=audio', '?lab=daily', '?cutscene=1'];
const results = {};
let fatal = null;
let srv;
let browser;
try {
  srv = await startPreview(dist, { from: Number(flags.port ?? 4179) });
  console.log('preview:', srv.url);
  browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required'] });
  for (const q of pages) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
    await ctx.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} -> ${e.blockedURI || 'inline'} @ ${e.sourceFile}:${e.lineNumber}`));
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 160)));
    page.on('requestfailed', (r) => errs.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
    try {
      await page.goto(srv.url + q);
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 30000 }).catch(() => errs.push('ready timeout'));
      // tap through anything that waits for their (title screen, windows, hold-to-charge gets a long press)
      for (let t = 0; t < secs; t++) {
        await page.mouse.move(187, 400);
        await page.mouse.down();
        await page.waitForTimeout(t % 3 === 2 ? 900 : 120);
        await page.mouse.up();
        await page.waitForTimeout(880);
      }
      if (flags.shots) await page.screenshot({ path: path.join(root, flags.shots, (q.replace(/[^a-z0-9]+/gi, '_') || 'root') + '.png') });
      results[q || '/'] = { csp: await page.evaluate(() => window.__csp), errors: errs.slice(0, 4) };
    } catch (e) {
      results[q || '/'] = { csp: [], errors: [...errs.slice(0, 3), String(e?.message ?? e).split('\n')[0]] };
    }
    await ctx.close();
  }
} catch (e) {
  fatal = String(e?.stack ?? e).slice(0, 1500);
} finally {
  await browser?.close().catch(() => {});
  await srv?.stop();
}
console.log(JSON.stringify(results, null, 2));
const bad = Object.entries(results).filter(([, r]) => r.csp.length || r.errors.length).map(([q]) => q);
if (fatal) console.error('PROBLEM: ' + fatal);
if (bad.length) console.error('PROBLEM on ' + bad.join(', '));
process.exitCode = fatal || bad.length ? 1 : 0;
