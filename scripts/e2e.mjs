// Runs the end-to-end scenarios in scripts/e2e/*.e2e.mjs against its own Vite dev server and Playwright Chromium, then
// stops only the processes it started. Exits 1 if any scenario fails.
// node scripts/e2e.mjs [--file=<name>] [--scenario=<name>] [--shard=<i>/<n>] [--parts] [--timings=<file>] [--jobs=<n>] [--cpu-throttle=<n>] [--headed] [--software] [--ws=<endpoint from scripts/e2e-browser.mjs> --port=<dev server port>]
// Scenarios run side by side in --jobs browsers (default one for every 4 of this machine's CPU threads, at most 4, and 1
// with --ws), each browser taking the longest one left. A file that exports `serial = true` runs its scenarios in the
// order they are written, one at a time in one browser.
// --shard=2/4 runs the second of four parts; scenarios are spread by the median of their recent CI seconds in
// scripts/e2e/timings.json, or in --timings over it (15 s for one listed in neither; a serial file goes whole to one
// part), so CI can run the parts in parallel.
// --file=names runs scripts/e2e/names.e2e.mjs only. Browsers use this machine's GPU (Vulkan) by default.
// --software explicitly uses SwiftShader on machines without a GPU, including browser children started by builds.
// --cpu-throttle=4 slows every page's CPU work by four through CDP; report.json records the requested rate and any failure.
// With --ws the browser runs on another machine (one with a real GPU). Start it there with scripts/e2e-browser.mjs,
// which gives it a local run's flags (--software and --headed go to that script, and --software also here so the
// renderer check expects SwiftShader) and listens on that machine's 127.0.0.1 only. An SSH tunnel from here forwards
// its port (-L) and the dev server's (-R), so both sides use 127.0.0.1. --ws needs --port, which keeps the dev server
// on the forwarded port, and the run first checks that the browser reaches this run's dev server (CONTRIBUTING.md).
// Writes report.json to artifacts/e2e/<time>/ and each scenario's files to <scenario>/ there, or failed/<scenario>/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseAst } from 'vite';
import { startHarness } from './e2e/harness.mjs';
import { folderOf, keep, mark, safe } from './e2e/keep.mjs';
import { undefinedNames } from './e2e-scope-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'scripts/e2e');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
for (const key of ['file', 'scenario', 'shard', 'timings', 'jobs', 'cpu-throttle', 'port']) {
  if (flags[key] === '') throw new Error(`--${key} needs a value`);
}
if (flags.jobs && !/^[1-9]\d*$/.test(flags.jobs)) throw new Error(`--jobs needs a whole number of 1 or more, got ${flags.jobs}`);
if (flags.ws && !flags.port) throw new Error('--ws needs --port, the dev server port the tunnel forwards with -R');
if (flags.port && !(/^[1-9]\d*$/.test(flags.port) && +flags.port <= 65535)) throw new Error(`--port needs a port number, got ${flags.port}`);
if (flags['cpu-throttle'] && (!Number.isFinite(Number(flags['cpu-throttle'])) || Number(flags['cpu-throttle']) < 1)) throw new Error(`--cpu-throttle needs a number of 1 or more, got ${flags['cpu-throttle']}`);
// With --software, one browser drawing the skills' 3D scenes keeps about 1.5 desktop cores busy. On
// CI's 4-vCPU runners two of them starved each other: short scenarios ran 4 to 12 times slower, and some timed out.
const jobs = flags.jobs ? +flags.jobs : flags.ws ? 1 : Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 4)));

// A key written twice in one object literal keeps only its last copy, so a scenario or a seed field would vanish unseen.
function twice(node, found = []) {
  if (node.type === 'ObjectExpression') {
    const seen = new Set();
    for (const p of node.properties) {
      if (p.type !== 'Property' || p.computed) continue;
      const key = (p.kind === 'init' ? '' : p.kind + ' ') + (p.key.name ?? p.key.value);
      if (seen.has(key)) found.push({ key, start: p.start });
      else seen.add(key);
    }
  }
  for (const v of Object.values(node)) if (v && typeof v === 'object') twice(v, found);
  return found;
}

const all = [];
const fileOf = new Map();
const folders = new Map([['running', 'the scenarios running'], ['failed', 'the failed scenarios']]);
const serial = new Set();
const quarantined = new Map();
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.e2e.mjs')).sort();
// a name a scenario uses but never defines would stop it only once a browser got there
const missing = undefinedNames(files.map((f) => path.join(dir, f)));
if (missing.length) throw new Error(`names used but never defined, each of which would stop its scenario:\n${missing.join('\n')}`);
for (const f of files) {
  const file = f.slice(0, -'.e2e.mjs'.length);
  const source = fs.readFileSync(path.join(dir, f), 'utf8');
  const repeats = twice(parseAst(source)).map(({ key, start }) => `"${key}" on line ${source.slice(0, start).split('\n').length}`);
  if (repeats.length) throw new Error(`${f} writes ${repeats.join(', ')} a second time in the same object, so the first copy never counts`);
  const mod = await import(pathToFileURL(path.join(dir, f)).href);
  const { scenarios } = mod;
  if (!scenarios || typeof scenarios !== 'object') throw new Error(`${f} does not export scenarios`);
  if (mod.serial === true) serial.add(file);
  for (const [name, run] of Object.entries(scenarios)) {
    if (fileOf.has(name)) throw new Error(`scenario "${name}" is in both ${fileOf.get(name)}.e2e.mjs and ${f}`);
    const folder = safe(name);
    if (!folder) throw new Error(`a scenario in ${f} has no name to make its folder from`);
    const owner = folders.get(folder);
    if (owner) throw new Error(`scenario "${name}" in ${f} would write to ${folder}/, the folder of ${owner}`);
    folders.set(folder, `scenario "${name}"`);
    if (typeof run !== 'function') throw new Error(`scenario "${name}" in ${f} is not a function`);
    fileOf.set(name, file);
    all.push({ name, file, run, i: all.length });
  }
  for (const [name, why] of Object.entries(mod.quarantined ?? {})) {
    if (!Object.hasOwn(scenarios, name)) throw new Error(`${f} quarantines "${name}", which is not one of its scenarios`);
    quarantined.set(name, why);
  }
}
if (flags.file && !all.some((s) => s.file === flags.file)) throw new Error(`no scenario file scripts/e2e/${flags.file}.e2e.mjs`);
if (flags.scenario && !fileOf.has(flags.scenario)) throw new Error('no scenario ' + flags.scenario);

const runnable = all.filter((s) => s.name === flags.scenario || !quarantined.has(s.name));
const held = all.filter((s) => !runnable.includes(s) && (!flags.file || s.file === flags.file));

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const committed = path.join(dir, 'timings.json');
const timings = {
  ...(fs.existsSync(committed) ? readJson(committed) : {}),
  ...(flags.timings ? readJson(path.resolve(flags.timings)) : {}),
};
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function weight(s) {
  const t = timings[s.name];
  const seconds = Array.isArray(t) && t.length ? median(t) : t;
  return Number.isFinite(seconds) ? seconds : 15;
}
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

const SLOWEST_RUNNER = 1.33;
const PART_BUDGET_S = 24 * 60;
function pack(n) {
  const load = Array(n).fill(0);
  const parts = Array.from({ length: n }, () => []);
  for (const unit of unitsOf(runnable)) {
    const k = load.indexOf(Math.min(...load));
    load[k] += unit.weight;
    parts[k].push(...unit.scenarios.map((s) => s.name));
  }
  return { load, parts };
}
const minutes = (load) => load.map((l) => Math.round(l / 60)).join(', ');

if (flags.parts) {
  const units = unitsOf(runnable);
  const fits = (seconds) => seconds * SLOWEST_RUNNER <= PART_BUDGET_S;
  const [longest] = units;
  if (longest && !fits(longest.weight)) {
    const [first] = longest.scenarios;
    const what = longest.scenarios.length > 1 ? `the serial file ${first.file}` : first.name;
    throw new Error(`${what} takes about ${Math.round(longest.weight / 60)} min, more than one part has time for`);
  }
  const total = units.reduce((sum, u) => sum + u.weight, 0);
  let n = Math.max(1, Math.ceil((total * SLOWEST_RUNNER) / PART_BUDGET_S));
  let load = pack(n).load;
  while (!fits(Math.max(...load))) load = pack(++n).load;
  const most = Math.max(...load) / 60;
  const slow = `${(most * SLOWEST_RUNNER).toFixed(1)} on a runner ${SLOWEST_RUNNER}x slower`;
  console.error(`${n} parts, the longest about ${most.toFixed(1)} min (${slow}; parts ${minutes(load)})`);
  console.log(n);
  process.exit(0);
}

let part = null;
if (flags.shard) {
  const m = /^(\d+)\/(\d+)$/.exec(flags.shard);
  if (!m || +m[1] < 1 || +m[1] > +m[2]) throw new Error(`--shard needs <i>/<n> with 1 <= i <= n, got ${flags.shard}`);
  const { load, parts } = pack(+m[2]);
  part = new Set(parts[+m[1] - 1]);
  const planned = Math.round(load[+m[1] - 1] / 60);
  console.log(`part ${flags.shard}: ${part.size} scenarios, about ${planned} min by CI timings (parts ${minutes(load)})`);
}
const matched = runnable.filter((s) => (!flags.file || s.file === flags.file) && (!flags.scenario || s.name === flags.scenario));
if (flags.scenario && !matched.length) throw new Error(`scenario ${flags.scenario} is not in ${flags.file}.e2e.mjs`);
for (const s of held) console.log(`quarantined ${s.name}: ${quarantined.get(s.name)}`);
const pick = matched.filter((s) => !part || part.has(s.name));
if (!pick.length) {
  console.log(matched.length ? `shard ${flags.shard} has no scenarios` : 'every scenario in this run is quarantined');
  process.exit(0);
}
const units = unitsOf(pick);

const CUT_OFF = 'cut off when the run was interrupted';
let h;
let report;
let interrupted = false;
let hung;
let ended = false;
const inFlight = new Map();
function saveReport() {
  const cutOff = [...inFlight.values()].map(({ t, ...s }) => ({ ...s, ok: false, ms: Date.now() - t, error: CUT_OFF }));
  const scenarios = [...report.scenarios, ...cutOff].sort((a, b) => a.i - b.i).map(({ i, ...s }) => s);
  fs.writeFileSync(path.join(h.root, 'report.json'), JSON.stringify({ ...report, scenarios }, null, 2));
}
const onSignal = () => {
  interrupted = true;
  process.exitCode = 130;
  if (!h) return;
  void h
    .stop()
    .catch((e) => console.error(e))
    .finally(() => {
      if (ended || hung) return;
      hung = setTimeout(() => {
        console.log("interrupted, and a scenario still hadn't ended 2 s after the browsers and the server stopped");
        try {
          if (report) saveReport();
        } catch (e) {
          console.error(e);
        }
        process.exit(130);
      }, 2000);
    });
};
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, onSignal);
let failed = 0;
try {
  h = await startHarness(flags);
  const lanes = [h, ...(await Promise.all(Array.from({ length: Math.min(jobs, units.length) - 1 }, () => h.more())))];
  report = { url: h.server.url, browser: flags.ws ? 'remote ' + flags.ws : 'local', jobs: lanes.length, scenarios: [], quarantined: held.map((s) => s.name), renderer: h.renderer, cpuThrottle: Number(flags['cpu-throttle'] ?? 1), throttleErrors: h.throttleErrors, zone: h.zone };
  await Promise.all(lanes.map(async (lane) => {
    for (let unit; !interrupted && (unit = units.shift()); ) {
      for (const { name, file, run, i } of unit.scenarios) {
        if (interrupted) break;
        const t = Date.now();
        inFlight.set(name, { name, file, t, i });
        lane.out =folderOf(h.root, name);
        fs.mkdirSync(lane.out, { recursive: true });
        const running = mark(h.root, name);
        let cleared = true;
        try {
          let result;
          try {
            result = await run(lane);
          } catch (e) {
            // what every page still open in this browser showed when the scenario failed
            if (!interrupted) await lane.evidenceAll('fail-' + safe(name));
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
          const why = interrupted ? CUT_OFF : keep(h.root, name);
          if (why) {
            cleared = false;
            if (!interrupted) mark(h.root, name, { failed: true });
            console.log(`${name}: what it wrote isn't in failed/: ${why}`);
          }
        }
        inFlight.delete(name);
        if (cleared) fs.rmSync(running, { force: true });
      }
    }
  }));
} finally {
  let stopError;
  try {
    await h?.stop();
  } catch (e) {
    stopError = e;
  }
  try {
    if (report) saveReport();
  } catch (e) {
    if (stopError) console.error(stopError);
    throw e;
  } finally {
    for (const sig of ['SIGINT', 'SIGTERM']) process.removeListener(sig, onSignal);
  }
  if (stopError) throw stopError;
}
ended = true;
clearTimeout(hung);
const passed = report.scenarios.filter((s) => s.ok).length;
console.log(`${passed}/${pick.length} passed, artifacts in ${path.relative(root, h.root)}`);
process.exitCode = interrupted ? 130 : failed ? 1 : 0;
