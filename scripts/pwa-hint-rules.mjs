// Who sees the install hint. Emulates iPhone browsers in Chromium (WebKit can't run on this host).
// node scripts/pwa-hint-rules.mjs   (BASE defaults to the dev server)
import { chromium, devices } from 'playwright';
const base = process.env.BASE ?? 'http://127.0.0.1:5173/';
const iphone = devices['iPhone 15'];
const safariUA = iphone.userAgent;
const cases = [
  { name: 'iPhone Safari, first visit', ua: safariUA, expect: true },
  { name: 'iPhone Safari, already dismissed', ua: safariUA, pre: () => localStorage.setItem('dbt.install-hint.v1', 'dismissed'), expect: false },
  { name: 'iPhone Safari, Home Screen app', ua: safariUA, init: () => Object.defineProperty(navigator, 'standalone', { get: () => true }), expect: false },
  { name: 'iPhone Safari, storage blocked', ua: safariUA, init: () => Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }), expect: false },
  { name: 'iPhone Chrome', ua: safariUA.replace('Version/', 'CriOS/124.0 Version/'), expect: false },
  { name: 'iPhone Discord in-app', ua: safariUA + ' Discord/250.0', expect: false },
  { name: 'iPad (desktop-class UA)', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', touch: 5, expect: true },
  { name: 'Mac Safari', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', expect: false },
  { name: 'Desktop Chrome', ua: undefined, expect: false },
];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] });
let pass = 0;
for (const c of cases) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, userAgent: c.ua, hasTouch: !!c.touch || c.ua === safariUA });
  if (c.touch) await ctx.addInitScript((n) => Object.defineProperty(navigator, 'maxTouchPoints', { get: () => n }), c.touch);
  if (c.ua && /Macintosh/.test(c.ua)) await ctx.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
  if (c.init) await ctx.addInitScript(c.init);
  const page = await ctx.newPage();
  await page.goto(base + '?lab=window');
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 30000 });
  if (c.pre) await page.evaluate(c.pre);
  await page.evaluate(() => { window.__r = import('/src/pwa/install-hint.ts').then((m) => m.maybeShowInstallHint()); });
  await page.waitForTimeout(1200);
  const shown = await page.evaluate(() => !!document.querySelector('.pwa-hint'));
  const ok = shown === c.expect;
  pass += ok;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}: shown=${shown} expected=${c.expect}`);
  if (c.name === 'iPhone Safari, first visit' && shown) {
    await page.click('.pwa-hint .sw-btn');
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    await page.evaluate(() => { window.__r = import('/src/pwa/install-hint.ts').then((m) => m.maybeShowInstallHint()); });
    await page.waitForTimeout(1200);
    const again = await page.evaluate(() => !!document.querySelector('.pwa-hint'));
    pass += !again;
    console.log(`${!again ? 'PASS' : 'FAIL'}  iPhone Safari, after tapping Got it and reloading: shown=${again} expected=false`);
  }
  await ctx.close();
}
await browser.close();
console.log(`${pass}/${cases.length + 1} passed`);
