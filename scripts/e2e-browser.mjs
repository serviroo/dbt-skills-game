// Starts the browser for `node scripts/e2e.mjs --ws=<endpoint>` on another machine: run this on the machine with the GPU
// and reach the endpoint it prints through an SSH tunnel (CONTRIBUTING.md). Anyone who can reach the endpoint can drive
// the browser, so it listens on this machine's 127.0.0.1 only. A running browser takes no new flags, so it starts with a
// local run's options; pass --software here as well as to the run. Ctrl+C closes the browser.
// node scripts/e2e-browser.mjs [--software] [--headed]
import { chromium } from 'playwright';
import { launchOptions } from './e2e/harness.mjs';

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
for (const key of Object.keys(flags)) {
  if (key !== 'software' && key !== 'headed') throw new Error(`--${key} is not an option: the browser listens on 127.0.0.1 only, so reach it through an SSH tunnel (CONTRIBUTING.md)`);
}
const server = await chromium.launchServer({ ...launchOptions(flags), host: '127.0.0.1' });
console.log(server.wsEndpoint());
