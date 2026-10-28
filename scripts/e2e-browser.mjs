// Starts the browser for `node scripts/e2e.mjs --ws=<endpoint> --host=<that machine's address>` on another machine: run
// this on the machine with the GPU and pass the endpoint it prints. A running browser takes no new flags, so it starts
// with a local run's options; pass --software here as well as to the run. Without --host it listens on this machine
// only. Ctrl+C closes the browser.
// node scripts/e2e-browser.mjs [--host=<this machine's address>] [--software] [--headed]
import { chromium } from 'playwright';
import { launchOptions } from './e2e/harness.mjs';

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
const server = await chromium.launchServer({ ...launchOptions(flags), host: flags.host });
console.log(server.wsEndpoint());
