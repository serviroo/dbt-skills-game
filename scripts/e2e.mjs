// Runs the end-to-end scenarios in scripts/e2e/*.e2e.mjs (file by file in name order) against its own Vite dev server
// and Playwright Chromium, then stops only the processes it started. Exits 1 if any scenario fails.
// node scripts/e2e.mjs [--file=<name>] [--scenario=<name>] [--shard=<i>/<n>] [--headed] [--gpu] [--ws=<playwright run-server endpoint> --host=<this machine's address>]
// --shard=2/4 runs the second of four parts; each file goes whole to one part, spread by its CI seconds in
// scripts/e2e/timings.json (15 s a scenario for a file not listed there), so CI can run the parts in parallel.
// --file=names runs scripts/e2e/names.e2e.mjs only. --gpu renders on this machine's GPU (Vulkan, or OpenGL on D3D12 in
// WSL) instead of SwiftShader, and stops if Chromium would draw in software; --gpu=NVIDIA also stops unless the GPU is NVIDIA's.
// With --ws the browser runs on another machine (one with a real GPU) and loads the dev server bound to --host.
// Writes screenshots and report.json to artifacts/e2e/<time>/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness } from './e2e/harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'scripts/e2e');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
for (const key of ['file', 'scenario', 'shard']) {
  if (flags[key] === '') throw new Error(`--${key} needs a value`);
}

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
let part = null;
if (flags.shard) {
  const m = /^(\d+)\/(\d+)$/.exec(flags.shard);
  if (!m || +m[1] < 1 || +m[1] > +m[2]) throw new Error(`--shard needs <i>/<n> with 1 <= i <= n, got ${flags.shard}`);
  const count = new Map();
  for (const { file } of all) count.set(file, (count.get(file) ?? 0) + 1);
  const timings = fs.existsSync(path.join(dir, 'timings.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'timings.json'), 'utf8')) : {};
  const weight = (file) => (Number.isFinite(timings[file]) ? timings[file] : 15 * count.get(file));
  const load = Array(+m[2]).fill(0);
  part = new Map();
  for (const file of [...count.keys()].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1))) {
    const k = load.indexOf(Math.min(...load));
    part.set(file, k + 1);
    load[k] += weight(file);
  }
  part = new Set([...part].filter(([, k]) => k === +m[1]).map(([file]) => file));
}
const matched = all.filter((s) => (!flags.file || s.file === flags.file) && (!flags.scenario || s.name === flags.scenario));
if (!matched.length) throw new Error(`scenario ${flags.scenario} is not in ${flags.file}.e2e.mjs`);
const pick = matched.filter((s) => !part || part.has(s.file));
if (!pick.length) {
  console.log(`shard ${flags.shard} has no scenarios`);
  process.exit(0);
}

let h;
let report;
let interrupted = false;
const onSignal = () => {
  interrupted = true;
  if (h) void h.stop().catch((e) => console.error(e));
};
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, onSignal);
let failed = 0;
try {
  h = await startHarness(flags);
  report = { url: h.server.url, browser: flags.ws ? 'remote ' + flags.ws : 'local', scenarios: [], renderer: h.renderer, zone: h.zone };
  for (const { name, file, run } of pick) {
    if (interrupted) break;
    const t = Date.now();
    try {
      let result;
      try {
        result = await run(h);
      } catch (e) {
        // what every page still open showed when the scenario failed
        if (!interrupted) await h.evidenceAll('fail-' + name.replace(/[^\w-]+/g, '-'));
        throw e;
      } finally {
        await Promise.all(h.browser.contexts().map((ctx) => ctx.close()));
      }
      report.scenarios.push({ name, file, ok: true, ms: Date.now() - t, ...(result !== undefined && { result }) });
      console.log(`ok   ${name} (${Date.now() - t} ms)`);
    } catch (e) {
      failed++;
      report.scenarios.push({ name, file, ok: false, ms: Date.now() - t, error: String(e?.message ?? e) });
      console.log(`FAIL ${name}: ${e?.message ?? e}`);
    }
  }
} finally {
  try {
    if (report) fs.writeFileSync(path.join(h.out, 'report.json'), JSON.stringify(report, null, 2));
  } finally {
    try {
      await h?.stop();
    } finally {
      for (const sig of ['SIGINT', 'SIGTERM']) process.removeListener(sig, onSignal);
    }
  }
}
console.log(`${report.scenarios.filter((s) => s.ok).length}/${pick.length} passed, artifacts in ${path.relative(root, h.out)}`);
process.exitCode = interrupted ? 130 : failed ? 1 : 0;
