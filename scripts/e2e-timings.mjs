// Adds the seconds each E2E scenario took in one or more runs' report.json files to a timings file, so --shard keeps
// the parts even: node scripts/e2e-timings.mjs [--file=<timings.json>] <report.json>...
// The file (scripts/e2e/timings.json unless --file names another) keeps each scenario's newest KEEP times, and --shard
// weighs a scenario by their median, so one slow runner doesn't skew it. CI adds every run's times to the e2e-timings
// artifact and the next run splits by it. Only passing scenarios count, scenarios not in a report keep their times, and
// names no scenario file has any more are dropped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KEEP = 5;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'scripts/e2e');
const args = process.argv.slice(2);
const fileFlag = args.find((a) => a.startsWith('--file='));
const reports = args.filter((a) => !a.startsWith('--'));
if (fileFlag === '--file=') throw new Error('--file needs a value');
if (!reports.length) throw new Error('give the report.json of every part of a run');

const names = new Set();
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.e2e.mjs'))) {
  for (const name of Object.keys((await import(pathToFileURL(path.join(dir, f)).href)).scenarios)) names.add(name);
}
const file = fileFlag ? path.resolve(fileFlag.slice('--file='.length)) : path.join(dir, 'timings.json');
const timings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
let n = 0;
for (const report of reports) {
  for (const s of JSON.parse(fs.readFileSync(report, 'utf8')).scenarios) {
    if (!s.ok || !Number.isFinite(s.ms)) continue;
    const had = timings[s.name];
    const times = Array.isArray(had) ? had : Number.isFinite(had) ? [had] : [];
    timings[s.name] = [...times, Math.max(1, Math.round(s.ms / 1000))].slice(-KEEP);
    n++;
  }
}
const kept = Object.fromEntries(
  Object.entries(timings)
    .filter(([name]) => names.has(name))
    .map(([name, t]) => [name, Array.isArray(t) ? t : [t]])
    .sort(([a], [b]) => (a < b ? -1 : 1)),
);
fs.writeFileSync(file, '{\n' + Object.entries(kept).map(([k, t]) => `  ${JSON.stringify(k)}: [${t.join(', ')}]`).join(',\n') + '\n}\n');
const missing = [...names].filter((name) => !(name in kept));
const untimed = missing.length ? `, no time yet for ${missing.join(', ')}` : '';
console.log(`${n} times from ${reports.length} reports, ${Object.keys(kept).length} scenarios timed${untimed}`);
