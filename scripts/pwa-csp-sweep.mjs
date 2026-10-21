// Loads every lab and the app from a built dist under its real CSP and lists any policy violations.
// node scripts/pwa-csp-sweep.mjs [--dist=dist] [--seconds=6] [--shots=<dir under the project>]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v = 'true'] = a.slice(2).split('='); return [k, v]; }));
const dist = path.resolve(root, flags.dist ?? 'dist');
const secs = Number(flags.seconds ?? 6);
const port = Number(flags.port ?? 4179);
const srv = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--outDir', dist], { cwd: root, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}/`;
for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required'] });
const pages = ['', '?lab=character', '?lab=window', '?lab=gate', '?lab=arise', '?lab=chest', '?lab=audio', '?lab=daily', '?cutscene=1'];
const results = {};
try {
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
    await page.goto(base + q);
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 30000 }).catch(() => errs.push('ready timeout'));
    // tap through anything that waits for her (title screen, windows, hold-to-charge gets a long press)
    for (let t = 0; t < secs; t++) {
      await page.mouse.move(187, 400);
      await page.mouse.down();
      await page.waitForTimeout(t % 3 === 2 ? 900 : 120);
      await page.mouse.up();
      await page.waitForTimeout(880);
    }
    if (flags.shots) await page.screenshot({ path: path.join(root, flags.shots, (q.replace(/[^a-z0-9]+/gi, '_') || 'root') + '.png') });
    results[q || '/'] = { csp: await page.evaluate(() => window.__csp), errors: errs.slice(0, 4) };
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.kill('SIGTERM');
}
console.log(JSON.stringify(results, null, 2));
