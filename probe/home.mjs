// probe: the live check's returning-home path, with a per-iteration trace
import { chromium } from 'playwright';
const [url, rate = '1', runs = '5'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const YOU = JSON.stringify({ name: 'Kit', companion: 'Lumen', nameAt: Date.now() - 1000, companionAt: Date.now() - 1000 });
const SEEN = JSON.stringify({ seenCutscene: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let fails = 0;
for (let r = 0; r < +runs; r++) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([you, seen]) => {
    if (sessionStorage.getItem('s')) return;
    sessionStorage.setItem('s', '1');
    localStorage.setItem('dbt.you.v1', you);
    localStorage.setItem('dbt.app.v1', seen);
  }, [YOU, SEEN]);
  await ctx.addInitScript((slow) => {
    window.__taps = [];
    addEventListener("pointerup", (e) => window.__taps.push((e.target?.className?.toString() ?? "").split(" ")[0].slice(0, 16) + (document.querySelector(".dq-scrim.is-on") ? "@scrim" : "") + (document.querySelector(".dq-sw") ? "@sw" : "")), true);
    if (slow) { const raf = requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((t) => { const s = performance.now(); while (performance.now() - s < slow) {} cb(t); }); }
  }, Number(process.env.SLOW ?? 0));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (+rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: +rate });
  const t0 = Date.now();
  await page.goto(url + '?mute');
  const trace = [];
  let clear = 0, i = 0;
  for (; i < 40 && clear < 3; i++) {
    const st = await page.evaluate(() => ({ sw: document.querySelectorAll('.dq-sw').length, scrim: !!document.querySelector('.dq-scrim.is-on'), mode: document.querySelector('.dq')?.dataset.mode ?? '-', at: (document.elementFromPoint(195, 700)?.className?.toString() ?? '').split(' ')[0].slice(0, 18), card: document.querySelector('.dq-card')?.className ?? '' }));
    const home = !st.sw && (await page.locator('.dq-tile').first().isVisible().catch(() => false));
    clear = home ? clear + 1 : 0;
    trace.push(`${Date.now() - t0}:${st.mode}${st.sw ? ' sw' : ''}${st.scrim ? ' scrim' : ''}${home ? ' HOME' : ''} ${st.card.includes('is-open') ? 'card-open ' : ''}${home ? '' : '>' + st.at}`);
    if (!home) await page.mouse.click(195, 700);
    await sleep(400);
  }
  const ok = clear >= 3;
  if (!ok) fails++;
  const taps = await page.evaluate(() => window.__taps);
  console.log(`run ${r} rate ${rate}: ${ok ? "ok" : "FAIL"} in ${Date.now() - t0} ms, ${i} reads; taps: ${taps.join(" ")}`);
  if (!ok || process.env.V) console.log('  ' + trace.join('\n  '));
  await ctx.close();
}
await browser.close();
console.log(`${fails}/${runs} failed`);
