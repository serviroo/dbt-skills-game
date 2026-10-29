// Runs the end-to-end scenarios in scripts/e2e/*.e2e.mjs against its own Vite dev server and Playwright Chromium, then
// stops only the processes it started. Exits 1 if any scenario fails.
// node scripts/e2e.mjs [--file=<name>] [--scenario=<name>] [--shard=<i>/<n>] [--jobs=<n>] [--cpu-throttle=<n>] [--headed] [--software] [--ws=<endpoint from scripts/e2e-browser.mjs> --port=<dev server port>]
// Scenarios run side by side in --jobs browsers (default one for every 4 of this machine's CPU threads, at most 4, and 1
// with --ws), each browser taking the longest one left. A file that exports `serial = true` runs its scenarios in the
// order they are written, one at a time in one browser.
// --shard=2/4 runs the second of four parts; scenarios are spread by their CI seconds in scripts/e2e/timings.json
// (15 s for one not listed there; a serial file goes whole to one part), so CI can run the parts in parallel.
// --file=names runs scripts/e2e/names.e2e.mjs only. Browsers use this machine's GPU (Vulkan) by default.
// --software explicitly uses SwiftShader on machines without a GPU, including browser children started by builds.
// --cpu-throttle=4 slows every page's CPU work by four through CDP; report.json records the requested rate and any failure.
// With --ws the browser runs on another machine (one with a real GPU). Start it there with scripts/e2e-browser.mjs,
// which gives it a local run's flags (--software and --headed go to that script, and --software also here so the
// renderer check expects SwiftShader) and listens on that machine's 127.0.0.1 only. An SSH tunnel from here forwards
// its port (-L) and the dev server's (-R), so both sides use 127.0.0.1; --port keeps the dev server on the forwarded
// port (CONTRIBUTING.md).
// Writes screenshots and report.json to artifacts/e2e/<time>/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness } from './e2e/harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'scripts/e2e');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
for (const key of ['file', 'scenario', 'shard', 'jobs', 'cpu-throttle', 'port']) {
  if (flags[key] === '') throw new Error(`--${key} needs a value`);
}
if (flags.jobs && !/^[1-9]\d*$/.test(flags.jobs)) throw new Error(`--jobs needs a whole number of 1 or more, got ${flags.jobs}`);
if (flags.port && !(/^[1-9]\d*$/.test(flags.port) && +flags.port <= 65535)) throw new Error(`--port needs a port number, got ${flags.port}`);
if (flags['cpu-throttle'] && (!Number.isFinite(Number(flags['cpu-throttle'])) || Number(flags['cpu-throttle']) < 1)) throw new Error(`--cpu-throttle needs a number of 1 or more, got ${flags['cpu-throttle']}`);
// With --software, one browser drawing the skills' 3D scenes keeps about 1.5 desktop cores busy. On
// CI's 4-vCPU runners two of them starved each other: short scenarios ran 4 to 12 times slower, and some timed out.
const jobs = flags.jobs ? +flags.jobs : flags.ws ? 1 : Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 4)));

const all = [];
const fileOf = new Map();
const serial = new Set();
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.e2e.mjs')).sort()) {
  const file = f.slice(0, -'.e2e.mjs'.length);
  const mod = await import(pathToFileURL(path.join(dir, f)).href);
  const { scenarios } = mod;
  if (!scenarios || typeof scenarios !== 'object') throw new Error(`${f} does not export scenarios`);
  if (mod.serial === true) serial.add(file);
  for (const [name, run] of Object.entries(scenarios)) {
    if (fileOf.has(name)) throw new Error(`scenario "${name}" is in both ${fileOf.get(name)}.e2e.mjs and ${f}`);
    if (typeof run !== 'function') throw new Error(`scenario "${name}" in ${f} is not a function`);
    fileOf.set(name, file);
    all.push({ name, file, run, i: all.length });
  }
}
if (flags.file && !all.some((s) => s.file === flags.file)) throw new Error(`no scenario file scripts/e2e/${flags.file}.e2e.mjs`);
if (flags.scenario && !fileOf.has(flags.scenario)) throw new Error('no scenario ' + flags.scenario);

const timings = fs.existsSync(path.join(dir, 'timings.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'timings.json'), 'utf8')) : {};
const weight = (s) => (Number.isFinite(timings[s.name]) ? timings[s.name] : 15);
/** What one browser runs at a time, longest first: a scenario, or a serial file's scenarios in order. */
function unitsOf(list) {
  const units = [];
  const files = new Map();
  for (const s of list) {
    let unit = serial.has(s.file) && files.get(s.file);
    if (!unit) {
      unit = { scenarios: [], weight: 0 };
      units.push(unit);
      if (serial.has(s.file)) files.set(s.file, unit);
    }
    unit.scenarios.push(s);
    unit.weight += weight(s);
  }
  return units.sort((a, b) => b.weight - a.weight || a.scenarios[0].i - b.scenarios[0].i);
}

let part = null;
if (flags.shard) {
  const m = /^(\d+)\/(\d+)$/.exec(flags.shard);
  if (!m || +m[1] < 1 || +m[1] > +m[2]) throw new Error(`--shard needs <i>/<n> with 1 <= i <= n, got ${flags.shard}`);
  const load = Array(+m[2]).fill(0);
  part = new Set();
  for (const unit of unitsOf(all)) {
    const k = load.indexOf(Math.min(...load));
    load[k] += unit.weight;
    if (k + 1 === +m[1]) for (const s of unit.scenarios) part.add(s.name);
  }
}
const matched = all.filter((s) => (!flags.file || s.file === flags.file) && (!flags.scenario || s.name === flags.scenario));
if (!matched.length) throw new Error(`scenario ${flags.scenario} is not in ${flags.file}.e2e.mjs`);
const pick = matched.filter((s) => !part || part.has(s.name));
if (!pick.length) {
  console.log(`shard ${flags.shard} has no scenarios`);
  process.exit(0);
}
const units = unitsOf(pick);

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
  const lanes = [h, ...(await Promise.all(Array.from({ length: Math.min(jobs, units.length) - 1 }, () => h.more())))];
  report = { url: h.server.url, browser: flags.ws ? 'remote ' + flags.ws : 'local', jobs: lanes.length, scenarios: [], renderer: h.renderer, cpuThrottle: Number(flags['cpu-throttle'] ?? 1), throttleErrors: h.throttleErrors, zone: h.zone };
  await Promise.all(lanes.map(async (lane) => {
    for (let unit; !interrupted && (unit = units.shift()); ) {
      for (const { name, file, run, i } of unit.scenarios) {
        if (interrupted) break;
        const t = Date.now();
        try {
          let result;
          try {
            result = await run(lane);
          } catch (e) {
            // what every page still open in this browser showed when the scenario failed
            if (!interrupted) await lane.evidenceAll('fail-' + name.replace(/[^\w-]+/g, '-'));
            throw e;
          } finally {
            await Promise.all(lane.browser.contexts().map((ctx) => ctx.close()));
          }
          report.scenarios.push({ name, file, ok: true, ms: Date.now() - t, i, ...(result !== undefined && { result }) });
          console.log(`ok   ${name} (${Date.now() - t} ms)`);
        } catch (e) {
          failed++;
          report.scenarios.push({ name, file, ok: false, ms: Date.now() - t, i, error: String(e?.message ?? e) });
          console.log(`FAIL ${name}: ${e?.message ?? e}`);
        }
      }
    }
  }));
  report.scenarios = report.scenarios.sort((a, b) => a.i - b.i).map(({ i, ...s }) => s);
} finally {
  let stopError;
  try {
    await h?.stop();
  } catch (e) {
    stopError = e;
  }
  try {
    if (report) fs.writeFileSync(path.join(h.out, 'report.json'), JSON.stringify(report, null, 2));
  } catch (e) {
    if (stopError) console.error(stopError);
    throw e;
  } finally {
    for (const sig of ['SIGINT', 'SIGTERM']) process.removeListener(sig, onSignal);
  }
  if (stopError) throw stopError;
}
console.log(`${report.scenarios.filter((s) => s.ok).length}/${pick.length} passed, artifacts in ${path.relative(root, h.out)}`);
process.exitCode = interrupted ? 130 : failed ? 1 : 0;
