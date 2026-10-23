// Runs the end-to-end scenarios in scripts/e2e/*.e2e.mjs (file by file in name order) against its own Vite dev server
// and Playwright Chromium, then stops only the processes it started. Exits 1 if any scenario fails.
// node scripts/e2e.mjs [--file=<name>] [--scenario=<name>] [--headed] [--gpu] [--ws=<playwright run-server endpoint> --host=<this machine's address>]
// --file=names runs scripts/e2e/names.e2e.mjs only. --gpu renders on this machine's GPU (Vulkan) instead of SwiftShader.
// With --ws the browser runs on another machine (one with a real GPU) and loads the dev server bound to --host.
// Writes screenshots and report.json to artifacts/e2e/<time>/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness } from './e2e/harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'scripts/e2e');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v = 'true'] = a.slice(2).split('='); return [k, v]; }));

const all = [];
const fileOf = new Map();
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.e2e.mjs')).sort()) {
  const file = f.slice(0, -'.e2e.mjs'.length);
  const { scenarios } = await import(pathToFileURL(path.join(dir, f)).href);
  if (!scenarios || typeof scenarios !== 'object') throw new Error(`${f} does not export scenarios`);
  for (const [name, run] of Object.entries(scenarios)) {
    if (fileOf.has(name)) throw new Error(`scenario "${name}" is in both ${fileOf.get(name)}.e2e.mjs and ${f}`);
    if (typeof run !== 'function') throw new Error(`scenario "${name}" in ${f} is not a function`);
    fileOf.set(name, file);
    all.push({ name, file, run });
  }
}
if (flags.file && !all.some((s) => s.file === flags.file)) throw new Error(`no scenario file scripts/e2e/${flags.file}.e2e.mjs`);
if (flags.scenario && !fileOf.has(flags.scenario)) throw new Error('no scenario ' + flags.scenario);
const pick = all.filter((s) => (!flags.file || s.file === flags.file) && (!flags.scenario || s.name === flags.scenario));
if (!pick.length) throw new Error(`scenario ${flags.scenario} is not in ${flags.file}.e2e.mjs`);

const h = await startHarness(flags);
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => h.stop().finally(() => process.exit(130)));
const report = { url: h.server.url, browser: flags.ws ? 'remote ' + flags.ws : 'local', scenarios: [], renderer: h.renderer };
let failed = 0;
try {
  for (const { name, file, run } of pick) {
    const t = Date.now();
    try {
      await run(h);
      report.scenarios.push({ name, file, ok: true, ms: Date.now() - t });
      console.log(`ok   ${name} (${Date.now() - t} ms)`);
    } catch (e) {
      failed++;
      report.scenarios.push({ name, file, ok: false, ms: Date.now() - t, error: String(e?.message ?? e) });
      console.log(`FAIL ${name}: ${e?.message ?? e}`);
    }
  }
} finally {
  fs.writeFileSync(path.join(h.out, 'report.json'), JSON.stringify(report, null, 2));
  await h.stop();
}
console.log(`${pick.length - failed}/${pick.length} passed, artifacts in ${path.relative(root, h.out)}`);
process.exit(failed ? 1 : 0);
