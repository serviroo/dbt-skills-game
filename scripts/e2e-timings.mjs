// Rewrites scripts/e2e/timings.json, the seconds each E2E scenario takes on CI, from the report.json files of a run,
// so --shard keeps the parts even: node scripts/e2e-timings.mjs <report.json>...
// Give it every part's report (CI keeps them as the e2e-<part> artifacts). Scenarios not in a report keep their old
// time, and names no scenario file has any more are dropped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'scripts/e2e');
const reports = process.argv.slice(2);
if (!reports.length) throw new Error('give the report.json of every part of a run');

const names = new Set();
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.e2e.mjs'))) {
  for (const name of Object.keys((await import(pathToFileURL(path.join(dir, f)).href)).scenarios)) names.add(name);
}
const file = path.join(dir, 'timings.json');
const timings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
let n = 0;
for (const report of reports) {
  for (const s of JSON.parse(fs.readFileSync(report, 'utf8')).scenarios) {
    timings[s.name] = Math.max(1, Math.round(s.ms / 1000));
    n++;
  }
}
const kept = Object.fromEntries(Object.entries(timings).filter(([name]) => names.has(name)).sort(([a], [b]) => (a < b ? -1 : 1)));
fs.writeFileSync(file, JSON.stringify(kept, null, 2) + '\n');
const missing = [...names].filter((name) => !(name in kept));
console.log(`${n} times from ${reports.length} reports, ${Object.keys(kept).length} scenarios timed${missing.length ? `, no time yet for ${missing.join(', ')}` : ''}`);
